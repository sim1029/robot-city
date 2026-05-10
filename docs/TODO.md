# Roadmap

| Milestone                       | Scope                                                                                                                                                              | Est.   |
|---------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------|
| **M2 Daily concierge**          | Google Calendar, morning briefs by default, user can add midday and evening crons optionally briefs (cron), `create_calendar_event`, `invite_attendees` w/ confirm | 2–3 wk |
| **M3 Session UX & cost meter**  | Forum-channel session model, per-message cost footer, model price table, session summary on close, `robot-city init` Discord auto-setup                            | 1–2 wk |
| **M4 Event-driven proactivity** | Urgency classifier on inbound mail, calendar-conflict watcher, follow-up tracker, quiet hours                                                                      | 1–2 wk |
| **M5 Admin dashboard**          | Token + cost charts by workflow / day, approval history, tool call audit. Single Hono-served SPA                                                                   | 1 wk   |
| **M6 Distribution polish**      | `npx robot-city` installer, auto-update channel, docs site                                                                                                         | 1–2 wk |

# Todo
 - Database relations for key user settings like daily concierge cron job runs (morning/midday/evening) needs to be generic enough to accomidate multiple opinionated settings options which will then be managed through discord gateway or the admin UI dashboard.
 - Discord Edit option for proposed emails agents compose
 - When sending an email, prompt user with two options when a decision has to be made (ex. "yes" reply email, "no" reply email)
 - Removing messageId from DM approval requests in discord and presenting the information more professionally (need to research what is capable to display in a discord DM potentially study other successful bots)
 - Each stage of the reasoning pipeline should save it's response as a column in the events table
 - Refine reasoning system prompt to understand that a classifer ran before it, need to call out what the original user message was and what portion was the classifier otherwise the model creates confusing respones to the discord user. An example is that the reasoning model was commenting on the classifier model's reasoning in the response but the user should be unaware that this pipeline is even running. 
 - Pipeline pricing should total the entire pipeline run, not just a single response
 - Since responses are not streamed the bot should react to users messages in threads immediately while the pipeline runs their response.

# Bugs

# Agent Instructions
When a todo is finished, just delete it from this file we use git commit history to track what has been completed in a project don't let todo or milestones build up forever