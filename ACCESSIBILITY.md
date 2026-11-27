# Accessibility

fleet-ops has no interface of its own. People meet it through Discord replies, failure notices and these docs, so that is what this covers.

## What it does today

- **Plain text replies.** Every `/fleet` reply is plain text with no colour, emoji or embed carrying meaning. A result reads the same through a screen reader as on screen.
- **Words, not symbols.** Notices and replies say in words whether something failed, was transient or was deferred, with the repository and the reason. A level is never shown by colour alone.
- **Short replies.** Replies are cut to Discord's 2,000 character limit and start with the outcome, so the result comes first.
- **Readable docs.** Tables have header rows, diagrams have a caption saying what they show and images in the docs have alt text.
- **Commands that do not depend on timing.** A slow command answers with Discord's "thinking" state and then edits its reply, so nothing has to be read before it disappears.

## Known gaps

- Discord's own client decides how the replies are presented. fleet-ops cannot change its contrast or font size.
- Mermaid diagrams render as images on GitHub. The text beside each one describes the same flow.

## Reporting a barrier

Open an issue with the bug report form or email contact@isaacadjei.me. Saying which part and what assistive technology you use helps.

## The shared statement

> [!NOTE]
> The full accessibility statement is in [zaccesss/accessibility](https://github.com/zaccesss/accessibility) and on [isaacadjei.me/accessibility](https://isaacadjei.me/accessibility). This file takes precedence where the two differ.
