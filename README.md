# GE-DESIGN Audit Plugin

The **GE-DESIGN Audit Plugin** is an internal **Design Ops** tool developed to monitor the health, quality, and adoption of the **GE-DESIGN** system. It scans entire Figma documents to extract analytical data and centralizes it into a local dashboard (Cockpit).

## Purpose

This tool serves three primary governance objectives:

1.  **Design Debt Tracking**: Automatically extracts Figma annotations to identify friction points, bugs, or components requiring updates.
2.  **Adoption Metrics (BI)**: Analyzes the usage of official components (prefixed with `GE_`, `MD_`, or `OCSTAT_`) to understand system reach and frequency.
3.  **Quality Assurance**: Detects detached official components, helping designers maintain interface consistency and library alignment.

## Key Features

* **Full Document Scanning**: Deep-scans every layer across all pages in the document.
* **Smart ID Detection**: Automatically retrieves the Figma `File Key` to ensure data integrity.
* **Manual Fallback**: Allows manual entry of the File ID for restricted environments (e.g., local drafts).
* **Direct Export**: One-click JSON report transmission to a local API server (`localhost:5000`).
* **Pre-flight Summary**: Displays key stats (annotations, detached layers, pages) within the UI before data submission.

## 🛠 Installation & Setup

### Prerequisites
* **Node.js** installed on the local machine.
* The **Audit Server** (Cockpit) must be running on port `5000`.

### Plugin Setup
1.  In Figma, create a new plugin: **Plugins > Development > New Plugin**.
2.  Copy the content of `code.ts` (backend logic) and `ui.html` (interface).
3.  Install dependencies and build:
    ```bash
    npm install
    npm run build
    ```

## How to Use

1.  Open the plugin within any GE-DESIGN project file.
2.  Verify that the **File Key** is correctly identified (displayed in blue).
3.  Click **Start Full Analysis** to process all pages.
4.  Review the summary grid.
5.  Click **Push to Cockpit** to archive the data for team-wide monitoring.

## Technical Stack

* **Environment**: Figma Plugin API
* **Languages**: TypeScript, HTML, CSS (Vanilla)
* **Communication**: Fetch API (JSON)
* **Target**: ECMAScript 2017+

---

*This project is part of the GE-DESIGN ecosystem for Design System governance.*