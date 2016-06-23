/**
 * Copyright(c) Starleaf Ltd. 2016.
 */


"use strict";


var transform = require('../transform');
var arrayEquals = require('../array-equals');

var copyObj = function (obj) {
    return JSON.parse(JSON.stringify(obj));
};

var getRandomSrrc = function (usedNumbers) {
    var min = 0;
    var max = 4294967295;
    var number = Math.floor(Math.random() * (max - min + 1) + min);

    while (usedNumbers.indexOf(number) > -1) {
        if (number < max) {
            number++;
        } else {
            number = 0;
        }
    }
    return number;
};


module.exports = function (desc, cache) {

    if (typeof desc !== 'object' || desc === null ||
        typeof desc.sdp !== 'string') {
        console.warn('An empty description was passed as an argument.');
        return desc;
    }

    var session = transform.parse(desc.sdp);

    // If the SDP contains no media, there's nothing to transform.
    if (typeof session.media === 'undefined' || !Array.isArray(session.media) || session.media.length === 0) {
        console.warn('The description has no media.');
        return desc;
    }

    // Try some heuristics to "make sure" this is a Plan B SDP. Plan B SDP has
    // a video, an audio and a data "channel" at most.
    if (session.media.length > 3 || !session.media.every(function (m) {
                return ['video', 'audio', 'data'].indexOf(m.mid) !== -1;
            }
        )) {
        console.warn('This description does not look like Plan B.');
        return desc;
    }

    // Make sure this Plan B SDP can be converted to a Unified Plan SDP.
    var bmids = [];
    session.media.forEach(function (m) {
            bmids.push(m.mid);
        }
    );

    var hasBundle = false;
    if (typeof session.groups !== 'undefined' &&
        Array.isArray(session.groups)) {
        hasBundle = session.groups.every(function (g) {
                return g.type !== 'BUNDLE' ||
                    arrayEquals.apply(g.mids.sort(), [bmids.sort()]);
            }
        );
    }

    if (!hasBundle) {
        throw new Error("Cannot convert to Unified Plan because m-lines that" +
            " are not bundled were found."
        );
    }

    var localRef;
    if (typeof cache.local !== 'undefined')
        localRef = transform.parse(cache.local);

    var remoteRef;
    if (typeof cache.remote !== 'undefined')
        remoteRef = transform.parse(cache.remote);


    var mLines = [];


    var ssrcsInUse = [];

    session.media.forEach(function (bLine) {
            console.log(JSON.parse(JSON.stringify(bLine)));
            if ((typeof bLine.rtcpMux !== 'string' ||
                bLine.rtcpMux !== 'rtcp-mux') &&
                bLine.direction !== 'inactive') {
                throw new Error("Cannot convert to Unified Plan because m-lines " +
                    "without the rtcp-mux attribute were found."
                );
            }

            //if we're offering to recv-only on chrome, we won't have any ssrcs at all.
            var sources = {};
            if (bLine.sources == null) {
                sources[getRandomSrrc(ssrcsInUse)] = {

                };
            } else {
                sources = bLine.sources;
            }

            sources = bLine.sources;
            var ssrcGroups = bLine.ssrcGroups || [];
            bLine.rtcp.port = bLine.port;

            var sourcesKeys = Object.keys(sources);
            if (sourcesKeys.length === 0) {
                return;
            }
            else if (sourcesKeys.length == 1) {
                var ssrc = sourcesKeys[0];
                ssrcsInUse.push(ssrc);
                var uLine = copyObj(bLine);
                uLine.mid = uLine.type + "-" + ssrc;
                mLines.push(uLine);
                return;
            }
            //we might need to split this line
            delete bLine.sources;
            delete bLine.ssrcGroups;


            ssrcGroups.forEach(function (ssrcGroup) {
                    //update in use ssrcs so we don't accidentally override it
                    ssrcGroup.ssrcs.forEach(function (ssrc) { ssrcsInUse.push(ssrc); });
                    var primary = ssrcGroup.ssrcs[0];
                    //use the first ssrc as the main ssrc for this m-line;
                    var copyLine = copyObj(bLine);
                    copyLine.sources = {};
                    copyLine.sources[primary] = sources[primary];
                    copyLine.mid = copyLine.type + "-" + primary;
                    mLines.push(copyLine);
                }
            );
        }
    );

    if (remoteRef !== undefined) {
        remoteRef.media.forEach(function (refline) {
                if (refline.sources !== undefined) {
                    var ssrcs = Object.keys(refline.sources);
                    ssrcs.forEach(function (ssrc) {
                            ssrcsInUse.push(ssrc);
                        }
                    );
                }
            }
        );
    }


    if (desc.type === "answer") {
        //if we're answering, if the browser accepted the transformed plan b we passed it,
        //then we're implicitly accepting every stream.
        //Check all the offers mlines - if we're missing one, we need to add it to our unified plan in recvOnly.
        //in this case the far end will need to dynamically determine our real SSRC for the RTCP stream,
        //as chrome won't tell us!

        if (remoteRef === undefined)
            throw Error(
                "remote cache required to generate answer - why didn't you munge it into plan b like a good boy?"
            );

        remoteRef.media.forEach(function (refline) {
                if (refline.mid === undefined)
                    return;
                var mid = refline.mid;
                var matched = mLines.some(function (mline) {
                        return (mline.mid == mid);
                    }
                );
                if (!matched) {
                    var type = refline.type;
                    for (var i = 0; i < mLines.length; i++) {
                        var mline = mLines[i];
                        if (mline.type == type) {
                            var linecopy = copyObj(mline);
                            var ssrckey = Object.keys(linecopy.sources)[0];
                            var cname = linecopy.sources[ssrckey].cname;
                            delete linecopy.sources;
                            linecopy.sources = {};
                            var randomssrc = getRandomSrrc(ssrcsInUse);
                            linecopy.sources[randomssrc] = {'cname': cname};
                            linecopy.mid = mid;
                            linecopy.direction = "recvonly";
                            mLines.push(linecopy);
                            break;
                        }
                    }
                }
            }
        );

        if (localRef !== undefined) {
            localRef.media.forEach(function (refline) {
                    if (refline.mid === undefined)
                        return;
                    var mid = refline.mid;
                    var matched = mLines.some(function (mline) {
                            return mline.mid == mid;
                        }
                    );
                    if (!matched) { // the remote side has set an m-line to inactive and removed it from the bundle.
                        var inactiveline = {};
                        inactiveline.port = 0;
                        inactiveline.type = refline.type;
                        inactiveline.protocol = refline.protocol;
                        inactiveline.payloads = refline.payloads;
                        inactiveline.connection = refline.connection;
                        inactiveline.connection.ip = "0.0.0.0";
                        inactiveline.direction = "inactive";
                        inactiveline.rtp = refline.rtp;
                        mLines.push(inactiveline);
                    }
                }
            );
        }
    }

    session.media = mLines;

    var mids = [];
    session.media.forEach(function (mLine) {
            mids.push(mLine.mid);
        }
    );

    session.groups.some(function (group) {
            if (group.type === 'BUNDLE') {
                group.mids = mids.join(' ');
                return true;
            }
        }
    );


    // msid semantic
    session.msidSemantic = {
        semantic: 'WMS',
        token: '*'
    };

    var resStr = transform.write(session);
    return new RTCSessionDescription({
            type: desc.type,
            sdp: resStr
        }
    );
};