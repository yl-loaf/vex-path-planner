function doGet(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var params = e && e.parameter ? e.parameter : {};
  var action = params.action || 'get';
  
  if (action === 'track') {
    var page = params.page || 'home';
    var clientId = params.clientId || 'anonymous';
    var ua = params.ua || 'Unknown';
    sheet.appendRow([new Date(), page, clientId, ua]);
  }
  
  var rows = sheet.getDataRange().getValues();
  var totalViews = rows.length > 1 ? rows.length - 1 : 0;
  var pages = { home: 0, ide: 0, translator: 0, stats: 0, other: 0 };
  var uniqueClients = {};
  var recentVisitors = [];
  
  for (var i = 1; i < rows.length; i++) {
    var rowDate = rows[i][0];
    var rowPage = rows[i][1] || 'home';
    var rowClient = rows[i][2] || 'anonymous';
    var rowUa = rows[i][3] || 'Unknown';
    
    if (pages[rowPage] !== undefined) pages[rowPage]++;
    else pages['other']++;
    
    uniqueClients[rowClient] = true;
    
    recentVisitors.unshift({ timestamp: rowDate, page: rowPage, userAgent: rowUa, ip: 'Device ID: ' + rowClient.substring(0, 6) + '...' });
  }
  
  var result = { 
    totalViews: totalViews, 
    uniqueVisitors: Math.max(1, Object.keys(uniqueClients).length), 
    totalSessions: totalViews,
    pages: pages, 
    visitors: recentVisitors 
  };
  
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}
     