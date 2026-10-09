# Changelog

The release workflow uses the section named after the version being released
as the release description, so every version needs one. `npm version <x.y.z>`
renames the `Unreleased` heading below to that version.

## 0.2.0

- Cards that work offline: turn on "Save card images in the vault" and a new or refreshed card downloads its image and site icon into your vault (up to 5 MB each) and points at those files.
- New command "Save the images of every card in this note" does the same for cards you already have, in one undo step.

## 0.1.0

- First release: `cardlink` blocks (the Auto Card Link format) drawn as cards in Reading view and Live Preview, the commands "Convert URL to card" and "Refresh card", and an optional card on paste.
