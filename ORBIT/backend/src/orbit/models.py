from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator

MU_SOURCE = "JPL DE440, https://ssd.jpl.nasa.gov/astro_par.html"
CENTERS = {
    "sun": {"name": "太阳", "mu": 132712440041.279419, "source": MU_SOURCE},
    "earth": {"name": "地球", "mu": 398600.435507, "source": MU_SOURCE},
}
FIELDS = ["epoch", "a", "e", "i", "raan", "arg_periapsis", "true_anomaly", "mean_anomaly"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Metadata(StrictModel):
    object_name: str = Field(default="轨道对象", min_length=1, max_length=120)
    center: Literal["sun", "earth"] = "sun"
    frame: Literal["J2000", "ECLIPJ2000"] = "J2000"
    reference_epoch: Literal["J2000.0 (JD 2451545.0 TT)"] = "J2000.0 (JD 2451545.0 TT)"
    epoch_mode: Literal["per_row", "single"] = "per_row"
    single_epoch: str | None = None
    time_scale: Literal["UTC", "TT", "TDB"] = "UTC"
    length_unit: Literal["km", "AU"] = "km"
    angle_unit: Literal["deg", "rad"] = "deg"
    mu_km3_s2: float | None = Field(default=None, gt=0)
    mu_source: str = ""
    metadata_status: Literal["provisional", "verified"] = "provisional"
    metadata_notes: str = Field(default="参考平面暂按 J2000 赤道面，待核实；UTCG 按 UTC 解释。", max_length=2000)
    max_interpolation_gap_s: float = Field(default=172800, gt=0, le=1e12)

    @model_validator(mode="after")
    def fill_mu(self):
        if self.mu_km3_s2 is None:
            self.mu_km3_s2 = CENTERS[self.center]["mu"]
            self.mu_source = CENTERS[self.center]["source"]
        elif not self.mu_source:
            self.mu_source = "用户指定"
        if self.epoch_mode == "single" and not self.single_epoch:
            raise ValueError("单历元模式需要填写根数历元")
        return self


class Decisions(StrictModel):
    deduplicate: bool = False
    sort: bool = False
    exclude_rows: list[int] = Field(default_factory=list, max_length=100000)
    conflict_choices: dict[str, int] = Field(default_factory=dict)
    override_units: bool = False


class ImportRequest(StrictModel):
    metadata: Metadata
    mapping: dict[str, str]
    decisions: Decisions = Field(default_factory=Decisions)


class Elements(StrictModel):
    a: float
    e: float
    i: float
    raan: float
    arg_periapsis: float
    true_anomaly: float


class PreviewRequest(StrictModel):
    elements: Elements  # km and degrees at API boundary, independent of CSV units
    metadata: Metadata
    radius_km: float = Field(gt=0, le=1e16)
    request_version: int = 0
