# exp_data_eval

Total assigned cases: 160
Failure count: 0

## Checks

- self_seed_match: 160/160
- other_seed_match: 160/160
- joint_seed_match: 160/160
- self_other_conflict: 160/160
- joint_is_third_model: 160/160
- joint_improves_over_self: 160/160
- joint_improves_other_over_self: 160/160
- dropdown_has_candidate: 160/160

## Dataset x Role

- acs_coverage/community_members: n=20, align={'self': 10, 'other': 10}, opponents={'defendants': 7, 'fairness_advocates': 6, 'judges': 7}, self_loss=0.1468, other_gain=0.5029, joint_gain=0.3561, dropdown_candidates=9.2
- acs_coverage/defendants: n=20, align={'self': 10, 'other': 10}, opponents={'community_members': 7, 'fairness_advocates': 6, 'judges': 7}, self_loss=0.0454, other_gain=0.2099, joint_gain=0.1645, dropdown_candidates=4.7
- acs_coverage/fairness_advocates: n=20, align={'self': 10, 'other': 10}, opponents={'community_members': 10, 'defendants': 5, 'judges': 5}, self_loss=0.1222, other_gain=0.2944, joint_gain=0.1722, dropdown_candidates=8.8
- acs_coverage/judges: n=20, align={'self': 10, 'other': 10}, opponents={'community_members': 7, 'fairness_advocates': 6, 'defendants': 7}, self_loss=0.0547, other_gain=0.3457, joint_gain=0.2910, dropdown_candidates=10.2
- compas/community_members: n=20, align={'self': 10, 'other': 10}, opponents={'defendants': 7, 'fairness_advocates': 6, 'judges': 7}, self_loss=0.1237, other_gain=0.3248, joint_gain=0.2012, dropdown_candidates=7.5
- compas/defendants: n=20, align={'self': 10, 'other': 10}, opponents={'community_members': 7, 'fairness_advocates': 6, 'judges': 7}, self_loss=0.0988, other_gain=0.2904, joint_gain=0.1916, dropdown_candidates=11.1
- compas/fairness_advocates: n=20, align={'self': 10, 'other': 10}, opponents={'community_members': 6, 'defendants': 7, 'judges': 7}, self_loss=0.0362, other_gain=0.2345, joint_gain=0.1983, dropdown_candidates=11.1
- compas/judges: n=20, align={'self': 10, 'other': 10}, opponents={'community_members': 7, 'defendants': 7, 'fairness_advocates': 6}, self_loss=0.0360, other_gain=0.2809, joint_gain=0.2448, dropdown_candidates=21.6
