# Player Load MVP

## Scope

Player Load stores observed player exposure for training sessions and matches.

The MVP deliberately does not model internal load, RPE, wellness, medical status,
or any predictive signal.

## Exposure Definition

The fundamental record is:

```text
player x activity x date
```

Supported activity types:

- `TRAINING`
- `MATCH`

The core total is deterministic and intentionally unweighted:

```text
totalExposureMinutes = trainingMinutes + matchMinutes
```

Training minutes and match minutes are kept separate in summaries. Any future
physiological load model must be implemented as a separate layer.

## MVP Tables

- `player_load_activities`: team activity on a date.
- `player_load_entries`: player participation and exposure minutes for that activity.

Existing entities reused:

- clubs
- seasons
- teams
- players
- team_players
- users
