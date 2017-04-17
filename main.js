var util = require('util');
var fs = require('fs');

var http = require('http');
var https = require('https');


var parseXML = require('xml2js').parseString;


var strava = require('strava-v3');


function reportLoginFailure(message)
{
    console.log('Login Failure: ', message);
}

function reportGetTracksFailure(message)
{
    console.log('Get Tracks Failure: ', message);
}

function reportTrackFailure(message)
{
    console.log('Track Fetch Failure: ', message);
}

var config;
var sessionID;
var lastCheckTime;

function uploadToStrava(id, name, desc, rawTrack)
{
    console.log('ID: ', id, 'Name: ', name);

    fs.writeFileSync(__dirname + '/data/' + id + '.gpx', rawTrack);

    strava.uploads.post(
        {
            data_type: 'gpx',
            activity_type: 'hike',
            file: 'data/' + id + '.gpx',
            private: 0,
            name: name,
            description: desc
        },
        function (err, payload)
        {
            console.log('Strava: ', err, payload);
        }
    );
}

function fetchTrack(trackID, cb)
{
    var reqDataHeaders =
    {
        'Cookie': 'sessionid=' + sessionID
    };

    getJSON({
        host: 'www.gaiagps.com',
        port: 443,
        path: '/api/objects/track/' + trackID + '.gpx/?publickey=',
        method: 'GET',
        headers: reqDataHeaders
    }, function (respStatusCode, respDataString)
    {
        if (respStatusCode === 200)
        {
            cb(respDataString);
        }
        else
        {
            reportTrackFailure('Request Failed: ' + respStatusCode);
        }
    });
}

function handleTrackFetch(trackID, trackData)
{
    if (trackData)
    {
        parseXML(trackData, function (err, parsedTrack)
        {
            var trackName = parsedTrack.gpx.trk[0].name[0];
            var trackDesc = parsedTrack.gpx.trk[0].desc[0];

            uploadToStrava(trackID, trackName, trackDesc, trackData);
        });
    }
}

function handleNewTacks(newTrackList)
{
    for (var i = 0; i < newTrackList.length; ++i)
    {
        var track = newTrackList[i];

        fetchTrack(track.id, handleTrackFetch.bind(undefined, track.id));
    }
}

function handleTracks(trackList)
{
    var newTracks = [ ];

    for (var i = 0; i < trackList.length; ++i)
    {
        var track = trackList[i];

        var createdTime = new Date(track.time_created);

        if (createdTime.getTime() > lastCheckTime.getTime())
        {
            console.log('New Track: ', JSON.stringify(track));

            newTracks.push(track);
        }
    }

    handleNewTacks(newTracks);
}


function runGetTracks()
{
    var reqDataHeaders =
    {
        'Cookie': 'sessionid=' + sessionID
    };

    getJSON({
        host: 'www.gaiagps.com',
        port: 443,
        path: '/api/objects/track?count=5000&page=1&routepoints=false&show_archived=false&show_filed=true&sort_direction=desc&sort_field=create_date',
        method: 'GET',
        headers: reqDataHeaders
    }, function (respStatusCode, respDataString)
    {
        if (respStatusCode === 200)
        {
            handleTracks(JSON.parse(respDataString));
        }
        else
        {
            reportGetTracksFailure('Request Failed: ' + respStatusCode);
        }
    });
}

function runGaiaLogin(username, password)
{
    var postData = 'username=' + username + '&password=' + password;

    var reqAuthHeaders =
    {
        'Content-Length': postData.length,
        'Content-Type': 'application/x-www-form-urlencoded'
    };

    getJSON({
        host: 'www.gaiagps.com',
        port: 443,
        path: '/login/',
        method: 'POST',
        headers: reqAuthHeaders,
        data: postData
    }, function (authStatusCode, authDataString, fullResult)
    {
        if (authStatusCode === 302 || authStatusCode === 200)
        {
            var cookieString;
            var authCookies = parseCookie(fullResult.headers['set-cookie'][0]);

            if (authCookies && authCookies['sessionid'])
            {
                sessionID = authCookies['sessionid'];

                runGetTracks();
            }
            else
            {
                reportLoginFailure('Missing SessionID: ' + fullResult.headers);
            }
        }
        else
        {
            console.log('Result: ', fullResult.haeders);

            reportLoginFailure('Request Failed: ' + authStatusCode);
        }
    });
}

function loadRunInfo()
{
    var runInfo = JSON.parse(fs.readFileSync(__dirname + '/data/runInfo.json'));

    lastCheckTime = new Date(runInfo.lastCheckTime);
}

function saveRunInfo()
{

}

function connectStrava(generateToken, cb)
{
    if (generateToken)
    {
        var accessURL = strava.oauth.getRequestAccessURL({ scope: 'write' });

        console.log('URL: ', accessURL);

        var path = accessURL.match("https://www.strava.com(.*)")[1];

        console.log('Path: ', path);

        getJSON({
            host: 'www.strava.com',
            port: 443,
            path: path,
            method: 'GET'
        }, function (oauthStatusCode, oauthDataString, fullResult)
        {
            console.log('Code: ', oauthStatusCode, 'Data: ', oauthDataString, 'Headers: ', fullResult.headers);
        });

        // strava.oauth.getToken('aa782abe3108a2acc62ba12a4777571cbd6bfadc', function (err, payload) {
        //     console.log('Error: ', err);
        //     console.log('Token: ', payload);
        // });
    }

    cb();
}

function loadConfig()
{
    config = JSON.parse(fs.readFileSync(__dirname + '/data/config.json'));

    loadRunInfo();

    var generateToken = true;

    connectStrava(generateToken, function ()
    {
        runGaiaLogin(config.username, config.password);
    });
}

loadConfig();




//
//
//
// Utility Functions
//
//
//

function getJSON(options, onResult)
{
    var prot = options.port === 443 ? https : http;

    var req = prot.request(options, function(res)
    {
        var output = '';

        res.setEncoding('utf8');

        res.on('data', function (chunk)
        {
            output += chunk;
        });

        res.on('end', function()
        {
            onResult(res.statusCode, output, res);
        });
    });

    req.on('error', function(err)
    {
        onResult(404, err.message);
    });

    if (options.timeout)
    {
        req.on('socket', function (socket)
        {
            socket.setTimeout(options.timeout);
        });
    }

    if (options.data)
    {
        req.write(options.data);
    }

    req.end();
};

function parseCookie(str)
{
  var obj = {}
    , pairs = str.split(/[;,] */);

  for (var i = 0, len = pairs.length; i < len; ++i) {
    var pair = pairs[i]
      , eqlIndex = pair.indexOf('=')
      , key = pair.substr(0, eqlIndex).trim().toLowerCase()
      , val = pair.substr(++eqlIndex, pair.length).trim();

    // quoted values
    if ('"' == val[0]) val = val.slice(1, -1);

    // only assign once
    if (undefined == obj[key]) {
      val = val.replace(/\+/g, ' ');
      try {
        obj[key] = decodeURIComponent(val);
      } catch (err) {
        if (err instanceof URIError) {
          obj[key] = val;
        } else {
          throw err;
        }
      }
    }
  }

  return obj;
};