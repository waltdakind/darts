var express = require('express');
var http = require('http');
var path = require('path');
var swig = require('swig');
var PouchDB = require('pouchdb');
var request = require('request');
var lessMiddleware = require('less-middleware');
var flash = require('connect-flash');
var browserify = require('browserify-middleware');
var fs = require('fs');
var dartEvents = require('./shared/dart-events');

var app = express();
app.engine('swig', swig.renderFile);

app.set('port', process.env.PORT || 3000);
app.set('view engine', 'swig');
app.set('views', __dirname + '/views');

// Proxy all requests to /darts to the local CouchDB instance.
//
// Have to do this before bodyparser or it messes things up.
// This proxies anything to /darts directly to the couchdb darts database.
var DATABASE_URL = 'http://localhost:5984';
app.use(function(req, res, next) {
  var proxyPath = req.originalUrl.match(/(^\/darts.*)$/);
  if(proxyPath){
    var dbUrl = DATABASE_URL + proxyPath[1];
    var requestOptions = {
      uri: dbUrl,
      method: req.method,
      headers: req.headers
    };
    // Now strip out the auth headers or couch will try to use them to
    // authenticate the user.
    delete requestOptions.headers.authorization;
      
    req.pipe(request(requestOptions)).pipe(res);
  } else {
    next();
  }
});

app.use(express.favicon());
app.use(express.logger('dev'));
app.use(express.bodyParser());
app.use(flash());
app.use(express.cookieParser());
app.use(express.cookieSession({secret: '!@HLSJ00184ljaoue0#'}));

// Set up an initial database if necessary.
var dbHost = process.env.DB || 'http://localhost:5984/darts';
console.info('Connecting to database at: %s', dbHost);
var db = new PouchDB(dbHost);
db = require('./shared/db')(db);
db.get(db.START_DOC_ID, function(err, doc) {
  if (err) {
    if (err.status == 404) {
      db.put({
        _id: db.START_DOC_ID,
        ranking: []
      }, function(err, response) {
        if (err) {
          console.error('Error creating initial document:', err);
          process.exit(1);
        } else {
          console.log('Creating initial document in database:', response);
        }
      });
    } else {
      console.error('Error checking for starting doc:', err);
      process.exit(1);
    }
  }
});

// Function that gets called on each database change. It's job is to ensure the
// database is consistent. For example, suppose we have two offline users, A and
// B that both record the results of different matches. Assume A's match happen
// before B's. If B gets online and sync's before A the data would be incorrect.
// However, when A gets online we'll get an update and we can then look at all
// documents that come *after* A and fix any problems.
var resolveChanges = function(change) {
  var doc = change.doc;
  db.allDocs({include_docs: true, startkey: doc._id},
      function(err, res) {
        if (err) {
          console.error('Unable to retrieve updated documents!', err);
        } else {
          console.log('%d documents exist after the changed document %s',
            res.rows.length - 1, doc._id);
          if (res.rows.length <= 1) {
            return;
          }
          // Starting with the first document, apply the changes in the next
          // document. If the computed rankings match the observed, we're done.
          // If not, we need to fix that document.
          var curRanking = res.rows[0].doc.ranking;
          for (var i = 1; i < res.rows.length; ++i) {
            console.log('Checking %s', res.rows[i].doc._id);
            var nextDoc = res.rows[i].doc;
            var newRanking =
              dartEvents.applyEvent(curRanking, nextDoc['event']);
            if (dartEvents.rankingsEqual(newRanking, nextDoc.ranking)) {
              console.info('Change consistent.');
              break;
            } else {
              console.info('Change requires update. ' +
                  'Computed ranking: %j. Old ranking: %j',
                  newRanking, nextDoc.ranking);
              nextDoc.ranking = newRanking;
              db.put(nextDoc);
            }
            curRanking = newRanking;
          }
        }
      });
};

// Listen to, and resolve, all database changes.
db.changes({
  include_docs: true,
  continuous: true,
  onChange: resolveChanges
});

// development only
if ('development' == app.get('env')) {
  app.use(express.errorHandler());
  // Disable the swig cache so templates are always re-rendered
  swig.setDefaults({ cache: false });
}



var STATIC_PATH = path.join(__dirname, '/static');
app.use(express.static(STATIC_PATH));
app.use(app.router);
app.use(lessMiddleware({
        dest: '/css',
        src: '/less', 
        root: STATIC_PATH
    }));

var requireAuth = function(req, res, next) {
  if (req.session && req.session.user) {
    next();
  } else if (req.path == '/manifest') {
    // Send a 404 if a user who isn't logged in request the manifest file. That
    // way they remove everything from their cache and can't use the app any
    // more (this also clears out older versions of the app that didn't use
    // cookie auth).
    console.log('User not logged in requested the manifest.');
    res.status(404).send('No manifest file until you log in');
  } else {
    console.log('User not logged in - redirecting to the login page');
    res.redirect('/login');
  }
};

// Browserify processes require() calls so we can build a single big JS file to
// serve and re-use modules between node and the browser. But, we don't want it
// to parse 3rd party modules for 2 reasons: first - for big libs like jquery
// it's really slow, and 2nd some (like pouchdb) can be used in the browser or
// in node so they do contain conditional requires which should be ignored.
var browserifyNoParse = fs.readdirSync('./js/third_party');
for (var ti = 0; ti < browserifyNoParse.length; ++ti) {
  browserifyNoParse[ti] = './js/third_party/' + browserifyNoParse[ti];
}
console.log('browserify will not parse: %j', browserifyNoParse);
app.get('/js/main.js', browserify('./js/main.js',
      {noParse: browserifyNoParse}));

app.get('/login', function(req, res) {
  res.render('login', {flash: req.flash('error')});
});

app.post('/login_submit', function(req, res, next) {
  console.log('login_submit called');
  if (req.body.username == 'darts' && req.body.password == 'D4rts') {
    console.log('User logged in');
    req.session.user = 'darts';
    res.redirect('/main');
  } else {
    console.log('User tried to log in with %s:%s. Back to login',
      req.body.username, req.body.password);
    req.flash('error', 'Incorrect username and/or password');
    res.redirect('login');
  }
});

app.get('*', requireAuth);

app.get('/manifest', function(req, res) {
  res.header("Content-Type", "text/cache-manifest");
  res.sendfile(__dirname + '/manifest/manifest', function(err) {
    if (err) {
      console.error('Error sending manifest:', err);
    } else {
      console.log('Mainfest file sent.');
    }
  });
});

app.get('/main', function(req, res) {
  res.render('main', {dbUrl: dbHost});
});

app.get('/ping', function(req, res) {
  var d = new Date();
  res.send(d.toString());
});

http.createServer(app).listen(app.get('port'), function(){
  console.log('Express server listening on port ' + app.get('port'));
});
