# OAuth Scope Encoding

## Purpose

This document explains how `wfcli auth login` builds the OAuth2 authorize URL scope parameter.

## Problem Statement

OAuth scope values are logically space-delimited (for example: `data openid profile`).
In URL query strings, spaces are commonly serialized as `+`, so the final authorize URL should contain:

`scope=data+openid+profile`

An incorrect implementation can double-encode and produce:

`scope=data%2Bopenid%2Bprofile`

`%2B` means a literal plus sign, not a space separator.

## Implemented Rule

Before building the authorize URL, `wfcli` normalizes scope by:

1. Trimming surrounding whitespace
2. Splitting by either spaces or `+`
3. Rejoining with a single space

Then `URLSearchParams` serializes that normalized value, producing `+` in the query string.

This means both input forms are accepted and produce the same URL parameter:

- `data openid profile`
- `data+openid+profile`

## Result

For the same config, both inputs now produce:

`...&scope=data+openid+profile&...`

and avoid:

`...&scope=data%2Bopenid%2Bprofile&...`

## Code Reference

- `src/infoplusClient.js`
  - `normalizeOAuthScope(scope)`
  - `buildAuthorizationCodeUrl(config, redirectUri, state)`

## Test Coverage

- `test/infoplus-client.test.js`
  - validates space-delimited input -> `scope=data+openid+profile`
  - validates plus-delimited input does not become `%2B`
- `test/auth-login.test.js`
  - validates the actual authorize request contains `scope=data+openid+profile`
