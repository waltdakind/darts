require('./third_party/jquery-1.9.1.min');
var PouchDB = require('./third_party/pouchdb-nightly.min.js');
var moment = require('./third_party/moment.min');

// Database
var db = new PouchDB('darts');

var MAX_DOC_ID = '9999-99-99T99:99:99';
var MIN_DOC_ID = '0000-00-00T00:00:00';

var getLatestDoc = function(cb) {
  db.allDocs({include_docs: true, endkey: MAX_DOC_ID,
    descending: true, limit: 1}, function(err, res) {
      if (err) {
        cb(err, null);
      } else {
        if (res.rows.length === 0) {
          return null;
        } else {
          console.assert(res.rows.length == 1);
          cb(null, res.rows[0].doc);
        }
      }
    });
};

// Return the document that comes before docid
var getPrevDoc = function(docid, cb) {
  getSecondDoc({descending: true, endkey: docid}, cb);
};

// Return the document that comes after docid
var getNextDoc = function(docid, cb) {
  getSecondDoc({descending: false, startkey: docid}, cb);
};

// Used by both getNextDoc and getPrevDoc. The only difference is if we sort
// the documents in ascending or descending order and if we're setting
// startKey or endKey so we take opts containing these two options and then
// merge in the common stuff.
var getSecondDoc = function(opts, cb) {
  opts.include_docs = true;
  opts.limit = 2;
  db.allDocs(opts, function(err, res) {
      if (err) {
        cb(err, null);
      } else {
        if (res.rows.length <= 1) {
          console.error('getSecondDoc only got one result: ', res);
        } else {
          cb(null, res.rows[1].doc);
        }
      }
    });
};

var docIdForNow = function() {
  d = new Date();
  var iso = d.toISOString();
  return iso.replace(/\.\d{3}Z/, '');
};

var insertWinner = function(p1, p2, winner) {
  getLatestDoc(function(err, curDoc) {
    if (err) {
      console.error('Uable to get latest document. Match not recorded');
      return;
    }

    var ranking = curDoc.ranking.slice(0);
    var p1i = ranking.indexOf(p1);
    var p2i = ranking.indexOf(p2);
    if (p1i < p2i) {
      if (winner == p2) {
        var t = ranking[p1i];
        ranking[p1i] = ranking[p2i];
        ranking[p2i] = t;
      }
    } else {
      if (winner == p1) {
        var t = ranking[p1i];
        ranking[p1i] = ranking[p2i];
        ranking[p2i] = t;
      }
    }

    var newDoc = {
      _id: docIdForNow(),
      'event': {
        type: 'Match',
        player1: p1,
        player2: p2,
        winner: winner
      },
      ranking: ranking
    };
    db.put(newDoc, function(err) {
      if (err) {
        console.error('Error inserting new rankings:', err);
      } else {
        console.log('Rankings updated');
        rTable.updateRankings();
      }
    });
  });
}

var RankingsTable = function() {
  var $table = $('#rankings');
  var $head = $('<thead><tr><th>Rankings</th></tr></thead>');
  // The id of the doc whose results are currently displayed
  var currentDoc = null;
  // If in history mode we can browse prior matches, but we can't record new
  // matches. When not in history mode, the rankings table always shows the
  // most recent rankings and updates when new matches are recorded.
  var historyMode = false;

  // The largest document in the database
  var lastDoc = MIN_DOC_ID;
  var firstDoc = MAX_DOC_ID;
  var $forwardBtn = $('#go-forward');
  var $backBtn = $('#go-back');
  var $histCheck = $('#hist-check');

  var afterMatchRecorded = function() {
    $matchForm.addClass('hidden');
    $('.selected').removeClass('selected');
  };

  var getMatchOutcome = function(p1, p2) {
    $matchForm = $('#match');
    $btnP1 = $('#match-p1');
    $btnP2 = $('#match-p2');
    $btnP1.val(p1);
    $btnP2.val(p2);

    $btnP1.off('click');
    $btnP1.on('click', function() {
      console.log('Winner is %s', p1);
      insertWinner(p1, p2, p1);
      afterMatchRecorded();
    });

    $btnP2.off('click');
    $btnP2.on('click', function() {
      console.log('Winner is %s', p2);
      insertWinner(p1, p2, p2);
      afterMatchRecorded();
    });

    $cancel = $('#cancel-match');
    $cancel.off('click');
    $cancel.on('click', function() {
      $matchForm.addClass('hidden');
      $('.selected').removeClass('selected');
    });

    $matchForm.removeClass('hidden');
  };


  var onHistClick = function(evnt) {
    if ($histCheck.prop('checked')) {
      $forwardBtn.removeClass('hidden');
      $backBtn.removeClass('hidden');
    } else {
      $forwardBtn.addClass('hidden');
      $backBtn.addClass('hidden');
      updateFromLatestDoc();
    }
  };

  $histCheck.on('click', onHistClick);

  var onRowClick = function() {
    if ($histCheck.prop('checked')) {
      console.log('Row clicked in historical mode - ignoring');
      return;
    }
    var $row = $(this);
    $row.toggleClass('selected');
    $selectedRows = $('.selected');
    if ($selectedRows.length > 1) {
      console.assert($selectedRows.length == 2);
      var p1 = $($selectedRows[0]).text();
      var p2 = $($selectedRows[1]).text();
      getMatchOutcome(p1, p2);
    }
  }

  var buildTable = function(ranking) {
    var $newTable = $('<table/>', {id: 'rankings'});
    $newTable.append($head);
    for (var i = 0; i < ranking.length; ++i) {
      $td = $('<td/>');
      $td.text(ranking[i]);
      $tr = $('<tr/>');
      $tr.click(onRowClick);
      $tr.append($td);
      $newTable.append($tr);
    }
    $table.replaceWith($newTable);
    $table = $newTable;
  };

  var displayEvent = function(doc) {
    if (!doc || !doc.event) {
      $('#event').text('None');
    }
    var evnt = doc.event;
    var dt = moment.utc(doc._id, 'YYYY-MM-DDTHH:mm:ss').local();
    var dateStr = dt.format('MMMM D, YYYY h:mm:ss A');
    var $datePart = $('<div/>', {'class': 'event-date'}).text(dateStr);
    if (evnt.type === 'New Player') {
      var txt = evnt.player + ' joined';
    } else {
      console.assert(evnt.type === 'Match');
      var winner = evnt.winner;
      if (evnt.player1 === evnt.winner) {
        var other = evnt.player2;
      } else {
        var other = evnt.player1;
      }
      var txt = winner + ' beat ' + other;
    }
    $eventPart = $('<div/>', {'class': 'event-summary'}).text(txt);
    $('#event').empty().append($datePart, $eventPart);
  };

  var displayDoc = function(doc) {
    console.log('Updating table with %s', doc._id);
    currentDoc = doc._id;
    buildTable(doc.ranking);
    displayEvent(doc);
    updateNavBtns();
  };


  var navForward = function() {
    console.log('Moving forward');
    console.assert(currentDoc);
    if (currentDoc < lastDoc) {
      getNextDoc(currentDoc, function(err, doc) {
        if (err) {
          console.error('Error getting the next document:', err);
        } else {
          console.assert(doc && doc._id > currentDoc);
          displayDoc(doc);
        }
      });
    } else {
      console.log('User click forward, but we are already displaying ' +
          'the latest document. Ignoring');
    }
  };

  var navBack = function() {
    console.log('Moving backward');
    console.assert(currentDoc);
    if (currentDoc > firstDoc) {
      getPrevDoc(currentDoc, function(err, doc) {
        if (err) {
          console.error('Error getting the previous document:', err);
        } else {
          console.assert(doc && doc._id < currentDoc);
          displayDoc(doc);
        }
      });
    } else {
      console.log('User click back, but we are already displaying ' +
          'the earliest document. Ignoring');
    }

  };

  $forwardBtn.on('click', navForward);
  $backBtn.on('click', navBack);

  var enableBtn = function($btn) {
    $btn.addClass('btn-enabled');
    $btn.removeClass('btn-disabled');
  };

  var disableBtn = function($btn) {
    $btn.removeClass('btn-enabled');
    $btn.addClass('btn-disabled');
  };

  var updateNavBtns = function() {
    if (currentDoc && currentDoc < lastDoc) {
      enableBtn($forwardBtn);
    }
    if (currentDoc && currentDoc > firstDoc) {
      enableBtn($backBtn);
    }
    if (currentDoc && currentDoc === lastDoc) {
      disableBtn($forwardBtn);
    }
    if (currentDoc && currentDoc === firstDoc) {
      disableBtn($backBtn);
    }
  };


  var updateFromLatestDoc = function() {
    getLatestDoc(function(err, doc) {
      if (err) {
        console.error('Unable to fetch latest document to build table');
      } else {
        if (doc) {
          displayDoc(doc);
        }
      }
    });
  };

  // Called when a changed document is detected.
  var updateOnChanges = function(change) {
    var doc = change.doc;
    // The min doc is just a place holder.
    if (doc._id == MIN_DOC_ID) {
      return;
    }

    if (doc._id > lastDoc) {
      lastDoc = doc._id;
      updateNavBtns();
    }
    if (doc._id < firstDoc) {
      firstDoc = doc._id;
      updateNavBtns();
    }

    if (!$histCheck.prop('checked') && doc._id > currentDoc) {
      // If not in historical mode and we got a new doc, show it.
      updateFromLatestDoc();
    } else if (currentDoc && doc._id == currentDoc) {
      // Update the currently viewed doc if it has changed.
      displayDoc(doc);
    }
  };

  updateFromLatestDoc();

  // Note that when we first start up, the updateOnChanges method will be
  // called with every single document in the database. That allows us to
  // maintain the firstDoc and lastDoc values.
  db.changes({
    include_docs: true,
    continuous: true,
    onChange: updateOnChanges
  });

  return {
    showRankings: buildTable,
    updateRankings: updateFromLatestDoc
  };
};

var setupAddUser = function(rankingsTable) {
  var $form = $('<div/>', {class: 'hidden'});
  var $name = $('<input/>', {type: 'text'});
  var $submit = $('<input/>', {type: 'submit', value: 'Submit'});
  var $cancel = $('<input/>', {type: 'button', value: 'Cancel'});

  $form.append($name, '<br>', $submit, $cancel);
  var $addBtn = $('#add-user-link');
  $addBtn.after($form);

  $addBtn.on('click', function() {
    $form.removeClass('hidden');
  });

  $cancel.on('click', function() {
    $form.addClass('hidden');
  });

  $submit.on('click', function() {
    getLatestDoc(function(err, doc) {
      if (err) {
        console.error('Error getting latest doc:', err);
      } else {
        var newDoc = {_id: docIdForNow(),
          'event': {type: 'New Player', player: $name.val()},
          ranking: doc.ranking
        };
        newDoc.ranking.push($name.val());
        db.put(newDoc, function(err) {
          if (err) {
            console.error('Error adding user!');
          } else {
            $form.addClass('hidden');
            rankingsTable.showRankings(newDoc.ranking);
          }
        });
      }
    });
  });
};

// This does several things:
//
// 1) When the manifest is updated the browser loads the new resources, but it
//    continues to use the old ones so to actually *use* new code after an
//    update it's necessary to hit reload twice. This detects that we've
//    downloaded an updated appcache and auto-reloads the page.
//
// 2) If we're running offline (we can tell because the last manifest fetch
//    failed) we schedule periodic re-checks of the manifest so we stay up to
//    date.
//
// 3) We schedule less frequent manifest checks so a page left open still
//    detects a new manifest.
//
// 4) Continuous database replication with PouchDB doesn't handle network issues
//    quite right. If the network is fine, replication is great, but if the
//    network goes down, replicaton fails. That's not too bad because pouch will
//    call the "complete" callback (continous replications are only "complete"
//    when they fail). However, if you restart replication in that callback and
//    it still fails the complete callback isn't called again. We therefore need
//    to track when we are and are not connected and manually restart
//    replication whenever the network link comes back.
var connectionHandling = function() {
  var appCache = window.applicationCache;
  $appCache = $(appCache);
  var NUM_MILLIS_PER_SEC = 1000;
  var OFFLINE_RECHECK_TIME_MILLIS = 10 * NUM_MILLIS_PER_SEC;
  var ONLINE_RECHECK_TIME_MILLIS = 10 * 60 * NUM_MILLIS_PER_SEC;

  var replicationInProgress = true;

  var tryAppCacheUpdate = function() {
    appCache.update();
  };

  $appCache.on('checking', function() {
    console.log('Checking for an updated manifest');
  });

  $appCache.on('error', function(e) {
    console.error('Error updating the applicatin cache. ' +
      'Will try again in %d seconds',
      OFFLINE_RECHECK_TIME_MILLIS / NUM_MILLIS_PER_SEC);
    setTimeout(tryAppCacheUpdate, OFFLINE_RECHECK_TIME_MILLIS);
  });

  $appCache.on('noupdate', function() {
    console.log('Applicaton cache is up to date. No changes found.');
    setTimeout(tryAppCacheUpdate, ONLINE_RECHECK_TIME_MILLIS);
    // Restart the database replication process.
    if (!replicationInProgress) {
      startReplication();
    }
  });

  $appCache.on('updateready', function() {
    console.log('Updated application cache found. Reloading the page.');
    // No more handling here because we'll keep reloading until the noupdate
    // event fires.
    window.location.reload();
  });

  var replicationError = function() {
    console.log('Replication failed. Will retry.');
    replicationInProgress = false;
    setTimeout(tryAppCacheUpdate, OFFLINE_RECHECK_TIME_MILLIS);
  };

  var startReplication = function() {
    var dbUrl = location.protocol + '//' + location.hostname;
    if (location.port) {
     dbUrl = dbUrl + ':' + location.port;
    }
    dbUrl = dbUrl + '/darts';
    console.info('Will replicate to %s', dbUrl);
    db.replicate.to(dbUrl, {continuous: true});
    // for continuous replication, complete is called only when replication fails.
    db.replicate.from(dbUrl, {continuous: true, complete: replicationError});
    replicationInProgress = true;
  };

  startReplication();
};

var rTable;
$(document).ready(function() {
  connectionHandling();
  rTable = RankingsTable();
  setupAddUser(rTable);
});