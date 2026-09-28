# Player Load LLM Context

## Purpose

`playerLoadContextService` builds a deterministic, provider-neutral context from
the metrics already calculated by the Player Load backend.

The context is intended for future narrative or assistant features. It is not an
LLM integration and does not call any external provider.

## Boundary

Player Load owns all calculations.

Future narrative consumers must receive the prepared context and explain or
summarize it. They must not recalculate:

- training attendance
- training minutes
- match minutes
- total exposure minutes
- period variation
- team comparison
- rankings

The exposure formula remains:

```text
totalExposureMinutes = trainingMinutes + matchMinutes
```

This represents observed exposure only.

## Context Shape

The exported builder is:

```js
const { buildPlayerLoadContext } = require('../services/playerLoadContextService');
```

It accepts the output of `getPlayerLoadHomeData` and returns:

```text
PlayerLoadContext {
  schemaVersion
  domain
  scope
  period
  team
  players
  rankings
  comparisons
}
```

Each player block contains:

```text
{
  player
  period
  training
  matches
  exposure
  previousPeriod
  teamComparison
  trend
  evolution
}
```

The `schemaVersion` field must be used by any future consumer to handle context
changes explicitly.

## Future Provider Integration

Add a separate adapter layer outside the Player Load domain, for example:

```text
src/services/llm/
  narrativeProvider.js
  providers/
    providerA.js
    providerB.js
```

The domain-facing contract should stay provider-neutral:

```js
async function generatePlayerLoadNarrative({
  question,
  context,
  locale,
}) {
  // Adapter chooses the configured provider.
}
```

The adapter can map `{ question, context, locale }` to the selected provider's
API. Player Load should only call that provider-neutral contract after the user
explicitly requests a narrative feature.

Provider SDK imports, credentials, prompt templates, retries, logging, and cost
controls belong in the adapter layer, not in `src/modules/playerLoad`.
