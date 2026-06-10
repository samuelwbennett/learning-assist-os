# Learning Assist OS

A Chrome extension that helps K–12 students get unstuck on math and reading work — without giving them the answer.

Deployed by **Elevate Edwards Summer Learning Program** (Vail Performance Academy), Edwards, CO.

---

## What It Does

When a student is working on a problem in Math Academy, IXL, Synthesis, or Khan Academy and gets stuck, they click the Learning Assist button. The extension offers a tiered "help ladder":

1. **Nudge** — restates the question in simpler words and asks a focusing question
2. **Hint** — suggests a general strategy without solving the problem
3. **Explain** — shows a worked example with *different* numbers and a different scenario
4. **Concept Summary** — explains the underlying topic in plain language
5. **Watch a Video** — finds a related Khan Academy lesson

A built-in leak classifier reviews every AI response before it reaches the student and blocks any response that reveals the actual answer.

---

## Architecture

```
[Student's Chromebook]
  Chrome extension (content.js)
      │
      │ HTTPS POST (problem text, session ID, grade level)
      ▼
[Vercel Serverless API — learning-assist-os.vercel.app]
  /api/assist.js
      │
      │ HTTPS (problem text only, no student identity)
      ▼
[OpenAI API]
  Returns hint/nudge text
      │
      ▼
  Leak classifier checks response
      │
      ▼
[Back to extension → displayed to student]
```

**Third-party services used:**
- **OpenAI API** — generates hint text. Only the problem text (what's on the student's screen) is sent. No student name, ID, or account information is transmitted.
- **Vercel** — hosts the serverless API. Vercel logs are used for telemetry (see Privacy section).

---

## Data Handling

### What is sent to the server

When a student requests help, the following is sent to the Vercel API:

| Field | Description | Stored? |
|---|---|---|
| Problem text | The text visible on the student's screen | No — used for the AI call only, never written to a database |
| Session ID | Random UUID generated at browser startup, resets each session | Vercel logs only (no PII) |
| Grade level | Optional, set during first-run setup | Vercel logs only |
| Request type | Which help level was requested (nudge, hint, etc.) | Vercel logs only |
| Truncated flag | Whether the problem text was clipped | Vercel logs only |
| IP address | Used for rate limiting only | Not stored |

### What is NOT collected

- Student name (stored locally in Chrome storage only, never sent to the server)
- Student account credentials
- Browsing history
- Keystroke or input data
- Any data from pages outside the configured learning platforms

### Telemetry

The extension sends anonymous usage events (e.g., "hint requested", "popup opened", "video dismissed") to the Vercel API. These events contain no page content and no personally identifiable information. Storage is Vercel's built-in console logs — there is no external database.

### OpenAI data practices

Problem text is sent to OpenAI solely to generate the hint response. OpenAI's API does not use API-submitted data to train models by default. See [OpenAI's privacy policy](https://openai.com/policies/privacy-policy) for details.

---

## COPPA Compliance Notes

- The extension does **not** collect names, emails, birthdates, or any persistent identifier tied to a child's identity.
- Session IDs are randomly generated and reset each browser session — they cannot be used to track a student across sessions or across devices.
- No student data is sold, shared with advertisers, or used for any purpose other than generating the tutoring response.
- Page content sent to OpenAI is transient — it is not written to any database by this application.
- The extension operates entirely within the school's managed Chromebook environment and is deployed via Google Admin Console.

---

## Permissions

The extension requests the following Chrome permissions:

| Permission | Reason |
|---|---|
| `storage` | Saves student's preferred language (English/Spanish) and optional grade level locally on the device |
| Host access to learning platforms | Required to inject the help button and read problem text from Math Academy, IXL, Synthesis, and Khan Academy |
| Host access to the Vercel API | Required to call the hint-generation backend |

---

## Installation (IT Administrators)

### MDM / Google Admin (recommended for managed Chromebooks)

1. Google Admin Console → **Devices → Chrome → Apps & Extensions**
2. Select the student Organizational Unit
3. Click **+** → **Add by URL**
4. Enter: `https://learning-assist-os.vercel.app/update.xml`
5. Set policy to **Force Install**

**Extension ID:** `liomablicahgcajpkifhmmlbjmhdknbd`

### Developer Mode (for testing)

1. Download the ZIP from the [GitHub repository](https://github.com/samuelwbennett/learning-assist-os)
2. Unzip the file
3. Navigate to `chrome://extensions`
4. Enable **Developer Mode**
5. Click **Load unpacked** and select the unzipped folder

---

## Source Code

[https://github.com/samuelwbennett/learning-assist-os](https://github.com/samuelwbennett/learning-assist-os)

---

## Contact

Samuel Bennett — samuel.bennett@vailperformanceacademy.com — 970-393-1335
