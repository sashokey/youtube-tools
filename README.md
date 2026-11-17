Adds native-style recommendation feedback, watched-video filtering, audio-only playback, and manual playlist navigation on desktop and mobile YouTube. Requires [Violentmonkey](https://violentmonkey.github.io/).

## Installation

Open the [userscript](https://raw.githubusercontent.com/sashokey/youtube-tools/refs/heads/master/youtube-tools.user.js), confirm installation in Violentmonkey, and reload YouTube.

## Usage notes

- Hover over or focus a thumbnail on desktop. Tap a thumbnail control on mobile. YouTube handles both actions and shows **Undo** in the confirmation.
- **Watched videos** and **Audio only** are available in the account menu on desktop and **Settings** on mobile. Home and channel pages hide fully and partially watched videos by default. Audio-only playback is off by default and changes apply when the next video loads or after a reload.
- Playlist playback stops at the end of each video. Use YouTube's **Next**, **Previous**, or playlist items to continue.
- Labels follow YouTube's language and use English when a translation is unavailable.
