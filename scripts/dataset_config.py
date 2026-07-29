"""Per-dataset knobs shared by the data post-processing scripts.

Every key here matches a dataset key in ``data/`` (and in the Flask app's
``DATASETS``). Feature names are the *display* names as they appear in the
exported case JSON (``case.features``), not the raw CSV column names.
"""

from __future__ import annotations

REPO_ROOT_MARKER = "data"

DATASETS = {
    "compas": {
        "source_dir": "compas",
        # (feature flag, subgroup label), checked in order; falls through to `race_reference`.
        "race_features": [
            ("African American", "African American"),
            ("Asian", "Asian"),
            ("Hispanic", "Hispanic"),
            ("Native American", "Native American"),
            ("Other race", "Other race"),
        ],
        "race_reference": "White",
        "sex_feature": "Female",
        # Legitimate case features for the Individual Fairness neighbourhood.
        # Race is deliberately excluded -- treating similar people differently
        # *because of* race is exactly what the criterion is meant to catch.
        # "numeric" features are log1p'd then min-max scaled; "binary" are used as-is.
        "similarity_numeric": ["Number of priors"],
        "similarity_binary": ["Misdemeanor", "Score factor", "Female"],
        # age bucket: below 25 -> 0, 25-45 -> 0.5, above 45 -> 1
        "similarity_age_buckets": ("Age below 25", "Age above 45"),
    },
    "acs_coverage": {
        "source_dir": "acs_coverage",
        "race_features": [
            ("Black", "Black"),
            ("Asian", "Asian"),
            ("Other race", "Other race"),
        ],
        "race_reference": "White",
        "sex_feature": "Female",
        # Eligibility-relevant features. Race indicators excluded, as for COMPAS.
        # Sex and recent birth stay in: pregnancy is an actual Medicaid
        # eligibility pathway, so it is a legitimate similarity axis here.
        "similarity_numeric": ["Personal income", "Age", "Education level"],
        "similarity_binary": [
            "Disability",
            "Employed",
            "Dependent child",
            "Female",
            "Gave birth last year",
        ],
        "similarity_age_buckets": None,
    },
}


def get(dataset: str) -> dict:
    if dataset not in DATASETS:
        raise SystemExit(f"Unknown dataset '{dataset}'; known: {sorted(DATASETS)}")
    return DATASETS[dataset]
