/**
 * Marfeel Recirculation Tagger — Google Apps Script
 * Receives feedback from the Chrome extension and writes to a Google Sheet.
 *
 * Setup:
 * 1. Create a new Google Apps Script project at script.google.com
 * 2. Paste this code
 * 3. Run setup() once to create the Sheet
 * 4. Deploy → New deployment → Web app → Execute as "Me", Access "Anyone"
 * 5. Copy the deployment URL into the extension
 */

function setup() {
  const ss = SpreadsheetApp.create('Recirculation Tagger - Feedback');
  const sheet = ss.getActiveSheet();
  sheet.setName('Feedback');

  // Headers
  const headers = [
    'Timestamp', 'User', 'Domain', 'URL', 'Page Type',
    'Modules Detected', 'Reviewed', 'Correct', 'Wrong', 'Ignored',
    'Feedback JSON'
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(1);

  // Auto-resize
  headers.forEach((_, i) => sheet.autoResizeColumn(i + 1));

  Logger.log('Sheet created: ' + ss.getUrl());
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // Find the sheet — use the first spreadsheet named "Recirculation Tagger - Feedback"
    const files = DriveApp.getFilesByName('Recirculation Tagger - Feedback');
    if (!files.hasNext()) {
      return ContentService.createTextOutput(JSON.stringify({ error: 'Sheet not found. Run setup() first.' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const ss = SpreadsheetApp.open(files.next());
    const sheet = ss.getSheetByName('Feedback') || ss.getActiveSheet();

    // Count verdicts
    const feedback = data.feedback || {};
    const entries = Object.values(feedback);
    const correct = entries.filter(f => f.verdict === 'correct').length;
    const wrong = entries.filter(f => f.verdict === 'wrong').length;
    const ignored = entries.filter(f => f.verdict === 'ignore').length;
    const reviewed = entries.filter(f => f.verdict).length;

    const row = [
      new Date().toISOString(),
      data.user || 'Anonymous',
      data.domain || '',
      data.url || '',
      data.pageType || '',
      data.modulesDetected || 0,
      reviewed,
      correct,
      wrong,
      ignored,
      JSON.stringify(feedback),
    ];

    sheet.appendRow(row);

    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
