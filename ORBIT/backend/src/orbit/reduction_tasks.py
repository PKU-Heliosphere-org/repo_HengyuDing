"""Cooperative, cancellable import tasks; only completed results are published."""
import logging
import threading
import uuid

from . import importer
from .table_reader import ReadCancelled

SLOTS = threading.BoundedSemaphore(2)
ACTIVE = {'queued', 'running', 'cancelling'}


class ReductionTask:
    def __init__(self, entry, selection, publish):
        self.id = str(uuid.uuid4())
        self.lock = threading.RLock()
        self.cancelled = threading.Event()
        self.status = 'queued'
        self.phase = 'reading'
        self.scanned = 0
        self.total = entry['parsed'].get('source_input_rows')
        self.total_exact = bool(entry['parsed'].get('source_count_exact'))
        self.result = None
        self.error = None
        self.entry, self.selection, self.publish = entry, selection, publish

    def snapshot(self):
        with self.lock:
            return {'id':self.id, 'status':self.status, 'phase':self.phase,
                    'scanned':self.scanned, 'total':self.total, 'total_exact':self.total_exact,
                    'result':self.result, 'error':self.error}

    def cancel(self):
        with self.lock:
            if self.status in ACTIVE:
                self.cancelled.set()
                self.status = 'cancelling'
            return self.snapshot()

    def progress(self, scanned, total, exact, phase):
        if self.cancelled.is_set():
            raise ReadCancelled()
        with self.lock:
            self.scanned = scanned
            self.phase = phase
            if exact or not self.total_exact:
                self.total = total
                self.total_exact = exact

    def start(self):
        threading.Thread(target=self.run, name='orbit-reduction-'+self.id[:8], daemon=True).start()

    def run(self):
        acquired = False
        try:
            while not acquired:
                if self.cancelled.is_set():
                    raise ReadCancelled()
                acquired = SLOTS.acquire(timeout=.1)
            with self.lock:
                if self.cancelled.is_set():
                    raise ReadCancelled()
                self.status = 'running'
            parsed = importer.read_table(self.entry['raw'], self.entry['filename'],
                        self.entry['parsed'].get('worksheet'), selection=self.selection,
                        allow_reduction=True, progress=self.progress, cancelled=self.cancelled.is_set)
            # Cancellation and publication share a lock: a cancelled task cannot commit later.
            with self.lock:
                if self.cancelled.is_set():
                    raise ReadCancelled()
                self.result = self.publish(parsed)
                self.scanned = parsed['source_scanned_rows']
                self.total = parsed['source_input_rows']
                self.total_exact = parsed['source_count_exact']
                self.phase = 'completed'
                self.status = 'completed'
        except ReadCancelled:
            with self.lock:
                self.status = 'cancelled'
        except importer.ImportProblem as exc:
            with self.lock:
                self.status = 'cancelled' if self.cancelled.is_set() else 'failed'
                self.error = {'message':exc.message, 'code':exc.code, 'details':exc.details}
        except Exception:
            logging.getLogger(__name__).exception('Import reduction failed')
            with self.lock:
                self.status = 'cancelled' if self.cancelled.is_set() else 'failed'
                self.error = {'message':'处理失败，请重试或重新导入文件', 'code':'reduction_failed'}
        finally:
            if acquired:
                SLOTS.release()
