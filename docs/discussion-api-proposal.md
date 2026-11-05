# Discussion API — proposal

**Status: proposal, not implemented.** The backend has no discussion tables or routes. The
quest discussion section and Quest Grove are a frontend prototype: with
`VITE_DISCUSSIONS_DEMO=true` on the dev server they use sample data kept in one browser tab
(`apps/frontend/src/discussionsDemo.js`). Without it, and in every production build, they
show that discussions aren't available. This document describes what the backend would need
so the prototype can be switched to a real service.

## Scopes

Every thread belongs to one scope:

| Scope | Who can read and post |
| --- | --- |
| `quest:{item_id}` | Students whose participation in that quest is `joined` or `approved` |
| `grove` | Any signed-in user |

Topics (`category`):

- Quest scopes: `teammates`, `help`, `tips`, `general`.
- Grove: `campus-life`, `quest-help`, `team-finder`, `ideas`, `general`.

## Endpoints

All responses are JSON:API documents like the rest of the API. All routes require a bearer
token.

### `GET /discussions/{scope}/threads`

Query parameters:

- `q`: case-insensitive search of the title and message.
- `category`
- `page[number]` and `page[size]`, with a maximum size of 50.

Returns threads newest first, each with:

- `id`, `scope`, `title`, `category`, `body`
- `author` (`{ id, name }`)
- `created_at`, `reply_count`

It also returns `meta.page` with `number`, `size`, `total_items` and `total_pages`.

### `POST /discussions/{scope}/threads`

The body is `{ title, category, body }`. Returns `201` with the new thread.

### `GET /discussions/threads/{thread_id}`

Returns the thread and its replies, oldest first. Replies are paginated the same way.

### `POST /discussions/threads/{thread_id}/replies`

The body is `{ body }`. Returns `201` with the reply.

### `POST /discussions/threads/{thread_id}/reports` and `POST /discussions/replies/{reply_id}/reports`

The body is `{ reason }`. Returns `202`. A user can report a given post only once.

### Errors

| Status | `code` | When |
| --- | --- | --- |
| 401 | — | Missing or expired token |
| 403 | `not_a_member` | Quest scope and the user's participation isn't `joined` or `approved` |
| 404 | `thread_not_found`, `item_not_found` | Missing or hidden thread, or a quest that doesn't exist or isn't published |
| 422 | `validation_error` | Limits below |
| 429 | `rate_limited` | Posting too fast; include `Retry-After` |

## Requirements for the backend

- **Persistence**:
  - Tables for threads, replies and reports.
  - Each row stores its scope, the author's user id and creation time.
  - Edits and soft deletes need their own timestamps.
  - Nothing is kept in the browser.
- **Author identity**:
  - The author is always the authenticated user from the token, never a field in the request body.
  - Responses include the author's display name from their profile.
- **Pagination**:
  - Both thread lists and replies are paginated on the server, with a maximum page size.
  - The frontend currently loads a whole sample scope at once.
- **Quest membership authorization**:
  - Every quest-scope request checks the caller's participation on the server.
  - A pending, rejected or missing participation gets `403 not_a_member`, and so does a former member.
  - The frontend's gating (`questDiscussionAccess`) only decides what the page offers. It isn't security.
  - Draft or archived quests return `404`.
- **Input limits**:
  - Title: 3–120 characters, trimmed.
  - Message: 1–4000 characters.
  - Reply: 1–2000 characters.
  - Category: one of the scope's allowed values.
  - Text is stored as plain text and never rendered as HTML. The frontend already renders it
    as text with preserved line breaks.
- **Moderation and reporting**:
  - Reports go to a moderator queue.
  - Moderators and admins can hide a thread or reply. Hidden content is left out of lists.
  - Authors can delete their own posts.
  - Moderator actions should be audited.
- **Rate limits**:
  - Per user, for example 5 threads per hour and 30 replies per hour.
  - When exceeded, return `429` with `Retry-After`.
- **No real-time features**:
  - Discussions are asynchronous. New posts appear on the next load.
  - No WebSockets, presence or online counts are needed or implied.

## Frontend switch-over

1. Add the endpoints to `apps/frontend/src/api.js`.
2. Have `getDiscussionClient` in `discussions.js` return a live client when the backend
   supports them. Keep the sample adapter for the dev-only flag.
3. Move search, category filtering and pagination to the query parameters above.
