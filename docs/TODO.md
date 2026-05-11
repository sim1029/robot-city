# Roadmap

| Milestone                       | Scope                                                                                                                                                              | Est.   |
|---------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------|
| **M3 Session UX & cost meter**  | Forum-channel session model, per-message cost footer, model price table, session summary on close, `robot-city init` Discord auto-setup                            | 1–2 wk |
| **M4 Event-driven proactivity** | Urgency classifier on inbound mail, calendar-conflict watcher, follow-up tracker, quiet hours                                                                      | 1–2 wk |
| **M5 Admin dashboard**          | Token + cost charts by workflow / day, approval history, tool call audit. Single Hono-served SPA                                                                   | 1 wk   |
| **M6 Distribution polish**      | `npx robot-city` installer, auto-update channel, docs site                                                                                                         | 1–2 wk |

# Todo
 - Discord Edit option for proposed emails agents compose
 - When sending an email, prompt user with two options when a decision has to be made (ex. "yes" reply email, "no" reply email)
 - Removing messageId from DM approval requests in discord and presenting the information more professionally (need to research what is capable to display in a discord DM potentially study other successful bots)
 - Each stage of the reasoning pipeline should save it's response as a column in the events table
 - Capture user preferences during onboarding process and pass along with system prompts.

# Bugs

# Agent Instructions
When a todo is finished, just delete it from this file we use git commit history to track what has been completed in a project don't let todo or milestones build up forever
