# Roadmap

| Milestone                       | Scope                                                                                            | Est.   |
|---------------------------------|--------------------------------------------------------------------------------------------------|--------|
| **M4 Event-driven proactivity** | Urgency classifier on inbound mail, calendar-conflict watcher, follow-up tracker, quiet hours    | 1–2 wk |
| **M5 Admin dashboard**          | Token + cost charts by workflow / day, approval history, tool call audit. Single Hono-served SPA | 1 wk   |
| **M6 Distribution polish**      | `npx robot-city` installer, auto-update channel, docs site                                       | 1–2 wk |

# Todo
 - Discord Edit option for proposed emails agents compose
 - When sending an email, prompt user with two options when a decision has to be made (ex. "yes" reply email, "no" reply email)
 - Removing messageId from DM approval requests in discord and presenting the information more professionally (need to research what is capable to display in a discord DM potentially study other successful bots)
 - Each stage of the reasoning pipeline should save it's response as a column in the events table
 - Capture user preferences during onboarding process and pass along with system prompts.
 - When I run development mode, I need to have a separate forum that the bot is listening on only in that mode so that I can have a VPC deployment running and also do dev work in my one discord channel
 - Take the development mode to the extreme and allow an id to get passed in so that I can create ephemeral environments for each PR and introduce an easy mechanism to clean them up

# Bugs

# Agent Instructions
When a todo is finished, just delete it from this file we use git commit history to track what has been completed in a project don't let todo or milestones build up forever
