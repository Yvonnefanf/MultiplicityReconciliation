# Final summative study stimulus set

This directory is a deterministic subset of `exp_data`, selected before collecting participant outcomes.
It contains 20 cases for each dataset × Self role (160 cases total). Case IDs are renumbered 0–19;
`source_case_id` preserves traceability to the source assignment.

## Selection constraints

- Negotiation policy: UI-first (Self chooses the first dropdown candidate; Other remains automatic).
- Only settled negotiations are eligible.
- Model-level Self sacrifice from v0 to the final negotiated model is at most 0.15.
- Mean selected model-level Self sacrifice: 0.0462; max: 0.1486.
- Each dataset is exactly 50% Self-aligned and 50% Other-aligned negotiated decisions (40/40).
- Each dataset × Self role has 7–13 cases in either direction.
- Every Self role includes at least 2 cases for each of the three Other roles.
- The objective rewards Negotiate over each middle condition and each middle condition over Single
  on both average label utility and Nash label utility, with an added penalty for Self sacrifice.
- A deterministic within-quota exchange refinement enforces the negotiation shape shown in the study figure:
  Self utility decreases from Self Optimal → Multi Optimal → Aggregate → Negotiate, while Other utility increases.
- Per dataset, Negotiate must beat the best middle condition by at least 0.050 Average utility
  and 0.065 Nash utility; the weakest middle condition must beat Single by at least
  0.120 Average utility and 0.140 Nash utility.

## Pooled outcome means

| Condition | Self | Other | Average | Nash |
|---|---:|---:|---:|---:|
| single | 0.439 | 0.426 | 0.432 | 0.156 |
| self_optimal | 0.771 | 0.432 | 0.602 | 0.344 |
| multi_optimal | 0.747 | 0.463 | 0.605 | 0.350 |
| aggregate | 0.685 | 0.526 | 0.605 | 0.347 |
| negotiate | 0.608 | 0.732 | 0.670 | 0.432 |

## Research-use note

This is a model-based stimulus preselection, not an unbiased estimate of performance on the full case population.
Report the selection rule in the study protocol and evaluate participant outcomes independently.
