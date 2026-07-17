const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const SPREADSHEET_ID = '126jqC2j5vJx3LawLCBR1GvQUK27I_gITzn-Bir-yar4';
const DATA_DIR = path.join(__dirname, '..', 'data');

async function syncSheetData() {
  console.log('🚀 Starting data sync...');
  
  const sheets = google.sheets({
    version: 'v4',
    auth: process.env.GOOGLE_API_KEY
  });
  
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  
  try {
    console.log(' Syncing Output Data...');
    await syncOutputData(sheets);
    
    console.log('⏰ Syncing Active Time...');
    await syncActiveTime(sheets);
    
    console.log('📝 Syncing Notes...');
    await syncNotes(sheets);
    
    console.log('📈 Syncing Overall Daily Summary...');
    await syncOverallSummary(sheets);
    
    console.log('✅ Sync completed successfully!');
  } catch (error) {
    console.error('❌ Sync failed:', error.message);
    process.exit(1);
  }
}

async function syncOutputData(sheets) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'The Output Data!A2:F2',
  });
  
  const rows = response.data.values || [];
  if (rows.length === 0) {
    console.log('  ⚠️ No output data found');
    return;
  }
  
  const row = rows[0];
  const period = row[0];
  const dateKey = normalizeDate(period);
  
  const filePath = path.join(DATA_DIR, 'output-data.json');
  let data = {};
  if (fs.existsSync(filePath)) {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }
  
  const summaryResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'The Output Data!B10:C12',
  });
  
  const summaryRows = summaryResponse.data.values || [];
  
  data[dateKey] = {
    period: period,
    productionUsers: parseInt(row[1]) || 0,
    productionHours: parseFloat(row[2]) || 0,
    trainingUsers: parseInt(row[3]) || 0,
    trainingHours: parseFloat(row[4]) || 0,
    totalHours: parseFloat(row[5]) || 0,
    totalUsers: summaryRows[0] ? parseInt(summaryRows[0][0]) || 0 : 0,
    avgHoursPerProductionUser: summaryRows[1] ? parseFloat(summaryRows[1][0]) || 0 : 0,
    avgHoursPerUser: summaryRows[2] ? parseFloat(summaryRows[2][0]) || 0 : 0,
  };
  
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  console.log(`  ✓ Saved output data for ${dateKey}`);
}

async function syncActiveTime(sheets) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Active Time!A2:G',
  });
  
  const rows = response.data.values || [];
  if (rows.length === 0) {
    console.log('  ⚠️ No active time data found');
    return;
  }
  
  const datePeriod = rows[0][0];
  const dateKey = normalizeDate(datePeriod);
  
  const labelerRows = [];
  for (const row of rows) {
    if (row[1]) {
      labelerRows.push({
        labeler: row[1] || '',
        tlQtc: row[2] || '',
        shift: row[3] || '',
        pc: row[4] || '',
        unit: row[5] || '',
        productiveHours: parseFloat(row[6]) || 0,
      });
    }
  }
  
  const analysisResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Active Time!I3:O6',
  });
  
  const shiftAnalysis = [];
  const analysisRows = analysisResponse.data.values || [];
  for (const row of analysisRows) {
    if (row[0] && ['M', 'N', 'ON', 'Unknown'].includes(row[0])) {
      shiftAnalysis.push({
        shift: row[0],
        productionUsers: parseInt(row[1]) || 0,
        productionHours: parseFloat(row[2]) || 0,
        trainingUsers: parseInt(row[3]) || 0,
        trainingHours: parseFloat(row[4]) || 0,
        avgPerProductionUser: parseFloat(row[5]) || 0,
        avgPerUser: parseFloat(row[6]) || 0,
      });
    }
  }
  
  const unmappedResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Active Time!I9:I20',
  });
  
  const unmappedUsers = [];
  const unmappedRows = unmappedResponse.data.values || [];
  for (const row of unmappedRows) {
    if (row[0] && row[0].includes('@')) {
      unmappedUsers.push(row[0]);
    }
  }
  
  const filePath = path.join(DATA_DIR, 'active-time.json');
  let data = {};
  if (fs.existsSync(filePath)) {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }
  
  data[dateKey] = {
    rows: labelerRows,
    shiftAnalysis: shiftAnalysis,
    unmappedUsers: unmappedUsers,
  };
  
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  console.log(`  ✓ Saved active time for ${dateKey} (${labelerRows.length} labelers, ${unmappedUsers.length} unmapped)`);
}

async function syncNotes(sheets) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Notes!A2:F',
  });
  
  const rows = response.data.values || [];
  if (rows.length === 0) {
    console.log('  ⚠️ No notes data found');
    return;
  }
  
  const notesByDate = {};
  for (const row of rows) {
    if (row[0]) {
      const period = row[0];
      const dateKey = normalizeDate(period);
      
      if (!notesByDate[dateKey]) {
        notesByDate[dateKey] = [];
      }
      
      notesByDate[dateKey].push({
        user: row[1] || '',
        trainingHours: parseFloat(row[2]) || 0,
        productionHours: parseFloat(row[3]) || 0,
        difference: parseFloat(row[4]) || 0,
        note: row[5] || '',
      });
    }
  }
  
  const filePath = path.join(DATA_DIR, 'notes.json');
  let data = {};
  if (fs.existsSync(filePath)) {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }
  
  for (const [dateKey, notes] of Object.entries(notesByDate)) {
    data[dateKey] = { rows: notes };
  }
  
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  console.log(`  ✓ Saved notes for ${Object.keys(notesByDate).length} date(s)`);
}

async function syncOverallSummary(sheets) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Overall Daily Summary!A2:I',
  });
  
  const rows = response.data.values || [];
  
  const summaryRows = [];
  for (const row of rows) {
    if (row[0]) {
      summaryRows.push({
        period: row[0],
        productionUsers: parseInt(row[1]) || 0,
        productionHours: parseFloat(row[2]) || 0,
        trainingUsers: parseInt(row[3]) || 0,
        trainingHours: parseFloat(row[4]) || 0,
        totalHours: parseFloat(row[5]) || 0,
        totalUsers: parseInt(row[6]) || 0,
        avgHoursPerProductionUser: parseFloat(row[7]) || 0,
        avgHoursPerUser: parseFloat(row[8]) || 0,
      });
    }
  }
  
  const filePath = path.join(DATA_DIR, 'overall-daily-summary.json');
  fs.writeFileSync(filePath, JSON.stringify({ rows: summaryRows }, null, 2));
  console.log(`  ✓ Saved overall summary (${summaryRows.length} days)`);
}

function normalizeDate(periodStr) {
  if (!periodStr) return '';
  const match = periodStr.match(/(\d{4})\s*,\s*(\d{2})-(\d{2})/);
  if (match) {
    return `${match[1]}-${match[2]}-${match[3]}`;
  }
  return periodStr;
}

syncSheetData();
