# Genius Lyrics & Notes for YouTube Music

Adds a **GENIUS** tab to YouTube Music's player-page sidebar, next to Up next, Lyrics and Related.

- **Lyrics:** the song's Genius lyrics. Lines that have a note are lightly highlighted. Click one to open its note right under the line, and click it again to close the note.
- **Notes:** every note on the song in one list, in song order, each under the line it explains.
- **About:** the song's Genius description, plus release date, album, writers, producers, other credits and page views.
- **Wrong song?** Pick a different Genius page or search for one. Your pick is remembered for that track.

Click any of YouTube Music's own tabs to switch back. The Genius tab follows the song as the queue moves on.

## Install

1. Unzip `genius-sidebar.zip`.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and choose the `genius-sidebar` folder.
4. Open music.youtube.com, play something and open the player page. The GENIUS tab is the last one in the sidebar.

This works in Chrome, Edge, Brave and other Chromium browsers.

## How it works

- The song is identified from the player bar's title and artist. Clutter such as "(Official Video)", "feat. …", "- Remastered" and "Artist - " prefixes is cleaned off before searching Genius.
- When a match isn't clear, the tab shows a short list to pick from instead of guessing. Translations, covers, remixes and live versions are skipped unless the YouTube Music title says that's what's playing.
- Requests go only to genius.com, only when the Genius tab is open, and without your Genius cookies. If Genius's bot check refuses the request, the extension retries once using the browser's genius.com cookies.
- Everything from Genius is rebuilt from a short list of safe elements (text, line breaks, links, images, lists, quotes) before it reaches YouTube Music's page. Scripts, embeds and event handlers are dropped, and links open in a new tab.
- In a narrow sidebar the tabs tighten up. If that still isn't enough room, the Genius tab shrinks to an icon.
- It works alongside the Spotify-Style Bar extension and Better Lyrics.

## Notes

- This uses the same endpoints genius.com's own site uses. It isn't an official API, so if Genius changes its site, the tab may stop loading until the extension is updated.
- Lyrics and notes belong to Genius and its contributors. The footer of every page links back to the song on Genius.
- Remembered picks are stored only in this browser, under the extension's local storage.
