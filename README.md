# Game Night

A self-hosted board game shelf and game night planner for Docker and Portainer. Everything runs in one container, with SQLite and uploaded photos in one persistent volume. No OpenAI account, Cloudflare service, external database, or hosted login is needed. Fonts are bundled locally. Internet access is only needed for optional BGG imports, external box images, and rules/video links you open.

## Portainer (Docker Standalone)

In Portainer, open **Stacks > Add stack > Repository** and enter:

| Field | Value |
| --- | --- |
| Repository URL | `https://github.com/xyciasav/boardgame_inventory.git` |
| Repository reference | `refs/heads/main` |
| Compose path | `compose.yml` |
| Repository authentication | Off (public repository) |

Add `APP_PASSWORD` in environment variables with your own password of at least 12 characters, then deploy. Optionally set `HOST_PORT` (default `43871`). Open `http://YOUR_DOCKER_HOST:43871` and enter the owner password. This uncommon host port avoids common defaults; if it is already in use on your host, choose another `HOST_PORT`.

The same `compose.yml` builds the image from the checked-out Dockerfile and runs it. `pull_policy: build` tells Compose to build locally rather than pull `game-night:local` from a registry. No separate Portainer file or image registry is needed.

For `reference not found`, use `refs/heads/main` (with the **s** in `heads`), or leave the reference blank to use the default branch. The Compose path must be exactly `compose.yml`.

Some Portainer versions have a [known issue building on remote Docker environments](https://docs.portainer.io/faqs/known-issues/docker-compose-files-including-build-steps-fail). If that specific image-build issue occurs after cloning succeeds, use the same Compose file directly on the Docker host:

```sh
git clone https://github.com/xyciasav/boardgame_inventory.git
cd boardgame_inventory
cp .env.example .env
# Edit .env and set APP_PASSWORD.
docker compose up -d --build
```

The named volume `game-night-data` stores both `/data/game-night.sqlite` and `/data/photos/`. Keep this volume when updating or recreating the container. This stack targets a single container on Docker Standalone. It is not a multi-replica or Docker Swarm deployment.

### Reverse proxy / HTTPS

Set `APP_ORIGIN` to the exact browser-facing origin, for example `https://games.example.com` (no trailing slash or path), and `COOKIE_SECURE=true` when using HTTPS. Use a reverse proxy for HTTPS if exposing the app outside your trusted LAN. Forward the original Host header. The app does not trust client-supplied identity or forwarded-user headers.

If using plain HTTP on your LAN, leave `COOKIE_SECURE=false`. Do not set secure cookies for an HTTP address, as the browser will not send them. With `APP_ORIGIN` empty, the app checks write-request origins against its Host header.

### Updating

For a Git-managed stack, use Portainer's **Pull and redeploy** action. Keep `game-night-data`. Restarting invalidates login sessions, so sign in again. Changing `APP_PASSWORD` requires recreating the container.

For a local checkout, run `git pull --ff-only` followed by `docker compose up -d --build`. Both Portainer and the CLI use `compose.yml`; run only one stack against the volume.

## Features

- Phone-first Tonight screen, player-count shortcuts, labeled bottom navigation, and large touch controls. Recommendations show the top three first, with more options available. Forms use bottom sheets on phones and ratings stay easy to reach.
- Visual owned-game library, search and style filters, editable metadata, starter catalog, manual game entry, and uploaded box photos.
- Simple player profiles with favorite styles and notes.
- Suggestions filtered by player count, time, and mood. Previous ratings of the exact game carry the most weight; preferences and similar-game ratings help with new picks. Reasons are shown next to each suggestion.
- Per-person thumbs-up / neutral / thumbs-down ratings and notes, editable play history, rulebook links, teaching notes, and external how-to-play video searches.
- JSON export/restore, server validation, and revision checks to stop stale tabs overwriting newer changes.

Starter covers are illustrated placeholders. Box-photo recognition and an AI rules chatbot are not implemented. Written notes are for reference and do not affect ranking. The starter catalog is not automatically added to your owned collection.

## Optional BoardGameGeek imports

Configure an approved application token as `BGG_API_TOKEN` in the container environment to enable XML API2 search/import. Leave it empty if you do not need imports. Manual entry, photos, and the starter catalog work without it. Tokens stay on your server. See [BGG’s application requirements](https://boardgamegeek.com/using_the_xml_api).

## Backups

Settings offers JSON export/restore for games, profiles, and play history. JSON contains photo links, not photo bytes. To preserve everything, also back up the data volume.

Stop the app container before copying the volume so SQLite and photos are consistent. For a stack named `game-night`:

```sh
docker compose -f compose.yml -p game-night stop
docker run --rm -v game-night-data:/data:ro -v "$PWD:/backup" alpine tar -czf /backup/game-night-data.tar.gz -C /data .
docker compose -f compose.yml -p game-night start
```

Alternatively, stop/start the stack in Portainer around the backup command. Store backups privately. To restore to a new empty named volume, stop the app, extract the archive into that volume, ensure its files are owned by UID/GID `1000:1000`, then start the app. A bind mount instead of the named volume also needs write permission for UID/GID `1000:1000`.

## Local development

Requires Node.js 24 or newer. There are no native npm compilation dependencies; SQLite is built into Node.

```sh
npm ci
npm run build
npm test
# Set APP_PASSWORD in your shell, then:
npm start
```

`npm start` serves both the built frontend and API on port `3000`, using `./data` by default. It fails clearly if `APP_PASSWORD` is missing or too short. Shell environment variables are used for local runs; `.env` is read by Docker Compose, not by the Node server automatically.

For hot reload, start the API with `APP_ORIGIN=http://127.0.0.1:5173`, then run `npm run dev` in another terminal and open that address. Vite proxies `/api` to port `3000`.

| Variable | Purpose |
| --- | --- |
| `APP_PASSWORD` | Required owner password, at least 12 characters |
| `APP_ORIGIN` | Exact browser-facing origin, especially behind a reverse proxy |
| `COOKIE_SECURE` | Set `true` for HTTPS |
| `DATA_DIR` | SQLite and photos directory; Docker defaults to `/data` |
| `PORT` | Container/server port, default `3000`; normally leave unchanged |
| `HOST_PORT` | Compose host port, default `43871` |
| `BGG_API_TOKEN` | Optional approved BGG application token |

Passwords are checked using scrypt; only hashed session tokens are stored. Sessions last up to seven days and expire on restart. Login attempts are rate-limited. Write endpoints check the request origin. The app serves no user collection or photos without a valid session.

CI runs unit/integration tests, builds the app, builds the Docker image, and checks container startup and its persistent volume. No workflow deploys or hosts the app.
