from enum import StrEnum


class SystemRole(StrEnum):
    USER = "user"
    SYSTEM_ADMIN = "system_admin"


class ProjectRole(StrEnum):
    MEMBER = "member"
    PROJECT_ADMIN = "project_admin"


class TaskMemberRole(StrEnum):
    OWNER = "owner"
    COLLABORATOR = "collaborator"
    REVIEWER = "reviewer"


class TaskStatus(StrEnum):
    NOT_STARTED = "not_started"
    IN_PROGRESS = "in_progress"
    PENDING_SUBMISSION = "pending_submission"
    PENDING_CONFIRMATION = "pending_confirmation"
    CLOSED = "closed"


class RiskLevel(StrEnum):
    SAFE = "safe"
    WATCH = "watch"
    HIGH = "high"
    OVERDUE = "overdue"
    BACKWALL_BREACHED = "backwall_breached"


class ImportKind(StrEnum):
    MEETING_SCHEDULE_IMAGE = "meeting_schedule_image"
    MEETING_MINUTES_PDF = "meeting_minutes_pdf"


class ImportStatus(StrEnum):
    UPLOADED = "uploaded"
    PROCESSING = "processing"
    REVIEW_REQUIRED = "review_required"
    CONFIRMED = "confirmed"
    FAILED = "failed"

