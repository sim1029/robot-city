# Roadmap

| Milestone                  | Scope                                                      | Est.   |
|----------------------------|------------------------------------------------------------|--------|
| **M6 Distribution polish** | `npx robot-city` installer, auto-update channel, docs site | 1–2 wk |

# Todo
 - Discord Edit option for proposed emails agents compose
 - When sending an email, prompt user with two options when a decision has to be made (ex. "yes" reply email, "no" reply email)
 - Removing messageId from DM approval requests in discord and presenting the information more professionally (need to research what is capable to display in a discord DM potentially study other successful bots)
 - Capture user preferences during onboarding process and pass along with system prompts.
 - Deterministic output for tool calls like create_event, save output tokens and provide 100% accurate data on what event was created and which calendar it was added to. Previously the message response to the user would often contain hallucinated dates and times of the event that was created.
 - Create a delete_event tool so we can edit(delete + create) and delete events from gcal. Does not need an approval card, model can choose to use it whevever.

# Bugs

# Agent Instructions
When a todo is finished, just delete it from this file we use git commit history to track what has been completed in a project don't let todo or milestones build up forever
