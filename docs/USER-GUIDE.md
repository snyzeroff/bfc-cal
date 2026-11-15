# User guide (board)

## The two calendars

- **Board calendar** (`/board/calendar`) shows everything: confirmed events (solid), tentative events and proposed dates (dashed), task deadlines, academic layers, and restricted periods (red hatching).
- **Members calendar** (`/`) shows only what a Board Admin has published.

Views: Month, Week, Day, Agenda and Timeline (a horizontal overview of several months with one row per academic calendar — the best view for choosing a date). Use **Layers** to show or hide academic calendars and kinds of period, and **Filter** for category, status, visibility, organiser, speaker or program.

Shortcuts: `N` new event · `T` today · `←` `→` navigate · `M` `W` `D` `A` `L` views · `G` then `C/E/S/T/A/O` to jump between sections.

## Planning a conference with an external speaker

1. **Speakers → Add speaker** (optional at first): keep the contact details, who on the board follows them, and where the conversation stands. This creates nothing public.
2. **New event** → category *Conference*, pick the speaker, choose **Propose dates** and enter the dates you are offering. They appear on the board calendar as tentative holds.
3. On the event's **Dates** tab, record the speaker's answer for each option (*available / unavailable / no answer*). **Find a suitable date** suggests days and explains each suggestion; it never claims people are free when it simply has no data.
4. **Confirm** the chosen option. The event gets its date and becomes *Confirmed*; the other options are released automatically (and kept under *Earlier options*).
5. **Tasks** tab: assign the preparation steps and deadlines (or start from the conference template, which creates them relative to the event date).
6. Fill in the public description, location and registration link, check the **Public preview** tab, then **Publish** (Board Admin). Only now does it appear on the members calendar and in subscriptions.
7. Later changes (time, room, cancellation) are saved once and propagate to the website and to subscribers' calendars at their next refresh.

## Registration through Luma, and featuring an event

On the event's **Details** tab, under *Public information*, paste the embed code Luma gives you (Luma event → Share → Embed) into **Luma registration widget**. Members can then register directly on the event page. Only Luma widgets are accepted.

A Board Admin can also switch on **Feature at the top of the members site**: while the event is published and upcoming it takes the headline spot of the home page (with its Luma widget if it has one) instead of the next event by date.

## The Victoriales rule

No conference can be scheduled in the 21 days before the Victoriales. The period is shown in red on the board calendar and on the dashboard. If you try to use one of those dates you get an explanation and the action is refused. Board meetings are not affected.

A Super Admin can record an exception: it requires a written reason, which is stored on the event and in the audit log.

If the Victoriales date changes, the period moves automatically and any conference already inside the new period is flagged for attention.

## Subscriptions

- Members: `/subscribe` explains how to add the public calendar to Apple, Google or Outlook.
- Board: **Subscriptions** → create your private address. It is shown once; rotate it if you lose it or if it leaks; revoke it when you no longer need it.
- How fast a change appears depends on the calendar app (Apple: minutes to an hour; Outlook: hours; Google: up to a day). The website is always current.

## Academic calendars (Board Admin)

**Academic → Import calendar**, choose the official PDF. The extracted periods go to a review screen: compare with the document, correct anything wrong directly in the row, approve what is right, reject the rest. Rows marked *Needs attention* are those the extractor was unsure about. Only approved periods appear as layers and influence scheduling.
