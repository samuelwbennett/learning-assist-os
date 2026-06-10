# Privacy Policy — Learning Assist OS

**Effective Date:** June 9, 2026
**Operator:** Vail Performance Academy / Elevate Edwards Summer Learning Program
**Contact:** Samuel Bennett — samuel.bennett@vailperformanceacademy.com

---

## Overview

Learning Assist OS is a Chrome extension deployed exclusively within a school-managed environment. It is designed to help K–12 students get tutoring support on schoolwork without receiving direct answers. This policy describes what data the extension collects, how it is used, and how it is protected.

---

## Children's Privacy (COPPA)

This extension is used by children under the age of 13. We take the following measures to comply with the Children's Online Privacy Protection Act (COPPA):

- We do **not** collect a child's name, email address, home address, phone number, geolocation, photo, or any other personal identifier.
- Session identifiers are randomly generated and non-persistent — they reset each time the browser is opened and cannot be used to identify or track a specific child.
- No student data is used for advertising, profiling, or any commercial purpose.
- No student data is sold or shared with third parties other than OpenAI (described below), which is used solely to generate tutoring responses.
- The extension is deployed and controlled by school IT administrators via Google Admin Console. Parents and guardians may contact us at the address above to request information about data practices.

---

## Data Collected

### Data sent to our server when a student requests help

| Data | Purpose | Retained? |
|---|---|---|
| Problem text (what's on screen) | Sent to OpenAI to generate a hint | No — never written to a database |
| Session ID (random UUID) | Rate limiting and usage analytics | Vercel logs (auto-deleted per Vercel's retention policy) |
| Request type (nudge/hint/etc.) | Usage analytics | Vercel logs |
| Grade level (optional) | Tailors response complexity | Vercel logs |
| IP address | Rate limiting | Not stored |
| Page hostname | Usage analytics (e.g., "mathacademy.com") | Vercel logs |

### Data stored locally on the student's device

| Data | Purpose |
|---|---|
| Preferred language (English/Spanish) | Remembers the student's language choice |
| Grade level (optional) | Set once during setup, used to personalize hint depth |

This data is stored in Chrome's local extension storage. It never leaves the device unless explicitly included in an API request (grade level only, not the student's name).

---

## Data We Do NOT Collect

- Student names, emails, or account credentials
- Keystrokes or typed input
- Browsing history outside of the configured learning platforms
- Any data from websites other than Math Academy, IXL, Synthesis, and Khan Academy
- Device identifiers, cookies, or persistent tracking tokens

---

## Third-Party Services

### OpenAI

Problem text is transmitted to OpenAI's API to generate tutoring responses. OpenAI does not use API-submitted content to train its models by default (see [OpenAI API data usage policy](https://openai.com/policies/api-data-usage-policies)). No student name or identity is included in these requests.

### Vercel

The extension's backend runs on Vercel's serverless platform. Vercel receives standard server logs (IP addresses, timestamps, request metadata). Vercel's privacy policy is available at [vercel.com/legal/privacy-policy](https://vercel.com/legal/privacy-policy).

---

## Data Retention

- **Problem text:** Never stored. Used only during the API call and discarded.
- **Server logs (Vercel):** Retained per Vercel's default log retention policy (typically 1–7 days for free tier logs).
- **Local device storage:** Retained until the extension is uninstalled or Chrome storage is cleared.

---

## Security

- All communication between the extension and the backend uses HTTPS/TLS.
- The backend applies PII redaction patterns to log data before writing (strips email addresses, phone numbers, SSNs, and long digit sequences).
- Rate limiting is enforced server-side to prevent abuse.
- The AI response is run through a leak classifier before being shown to the student, to ensure no direct answers are returned.

---

## Changes to This Policy

If we make material changes to this policy, we will update the effective date above and notify the school's IT administrator.

---

## Contact

For questions about this privacy policy or to exercise any rights regarding student data:

**Samuel Bennett**
Vail Performance Academy / Elevate Edwards
samuel.bennett@vailperformanceacademy.com
970-393-1335
