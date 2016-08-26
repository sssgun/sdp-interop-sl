/**
 * Copyright(c) Starleaf Ltd. 2016.
 */


"use strict";


var transform = require('../transform');
var arrayEquals = require('../array-equals');

var copyObj = function (obj) {
    return JSON.parse(JSON.stringify(obj));
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
            if(m.port !== 0) { //ignore disabled streams, these can be removed from the bundle
                bmids.push(m.mid);
            }
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

    var localRef = null;
    if (typeof cache.local !== 'undefined')
        localRef = transform.parse(cache.local);

    var remoteRef = null;
    if (typeof cache.remote !== 'undefined')
        remoteRef = transform.parse(cache.remote);


    var mLines = [];

    session.media.forEach(function (bLine, index, lines) {

        var uLine;
        var ssrc;

        /*if ((typeof bLine.rtcpMux !== 'string' ||
            bLine.rtcpMux !== 'rtcp-mux') &&
            bLine.direction !== 'inactive') {
            throw new Error("Cannot convert to Unified Plan because m-lines " +
                "without the rtcp-mux attribute were found.");
        }*/
        if(bLine.port === 0) {
            // change the mid to the last used mid for this media type, for consistency
            if(localRef !== null && localRef.media.length > index) {
                bLine.mid = localRef.media[index].mid;
            }
            mLines.push(bLine);
            return;
        }

        // if we're offering to recv-only on chrome, we won't have any ssrcs at all
        if (!bLine.sources) {
            uLine = copyObj(bLine);
            uLine.sources = {};
            uLine.mid = uLine.type + "-" + 1;
            mLines.push(uLine);
            return;
        }

        var sources = bLine.sources || null;

        if (!sources) {
            throw new Error("can't convert to unified plan - each m-line must have an ssrc");
        }

        var ssrcGroups = bLine.ssrcGroups || [];
        bLine.rtcp.port = bLine.port;

        var sourcesKeys = Object.keys(sources);
        if (sourcesKeys.length === 0) {
            return;
        }
        else if (sourcesKeys.length == 1) {
            ssrc = sourcesKeys[0];
            uLine = copyObj(bLine);
            uLine.mid = uLine.type + "-" + ssrc;
            mLines.push(uLine);
        }
        else {
            //we might need to split this line
            delete bLine.sources;
            delete bLine.ssrcGroups;

            ssrcGroups.forEach(function (ssrcGroup) {
                //update in use ssrcs so we don't accidentally override it
                var primary = ssrcGroup.ssrcs[0];
                //use the first ssrc as the main ssrc for this m-line;
                var copyLine = copyObj(bLine);
                copyLine.sources = {};
                copyLine.sources[primary] = sources[primary];
                copyLine.mid = copyLine.type + "-" + primary;
                mLines.push(copyLine);
            });
        }
    });

    if (desc.type === 'offer') {
        if (localRef) {
            // you can never remove media streams from SDP.
            while (mLines.length < localRef.media.length) {
                var copyline = localRef.media[mLines.length];
                copyline.port = 0;
                mLines.push(copyline);
            }
        }
    }
    else {
        //if we're answering, if the browser accepted the transformed plan b we passed it,
        //then we're implicitly accepting every stream.
        //Check all the offers mlines - if we're missing one, we need to add it to our unified plan in recvOnly.
        //in this case the far end will need to dynamically determine our real SSRC for the RTCP stream,
        //as chrome won't tell us!

        if (remoteRef === undefined) {
            throw Error("remote cache required to generate answer?");
        }
        remoteRef.media.forEach(function(remoteline, index) {
            if(index < mLines.length) {
                // the line is already present in the plan-b, so will be handled correctly by the browser;
                return;
            }
            if(remoteline.mid === undefined) {
                console.warn("remote sdp has undefined mid attribute");
                return;
            }
            if(remoteline.port === 0) {
                var disabledline = {};
                disabledline.port = 0;
                disabledline.type = remoteline.type;
                disabledline.protocol = remoteline.protocol;
                disabledline.payloads = remoteline.payloads;
                disabledline.mid = remoteline.mid;
                if(!session.connection) {
                    if(mLines[0].connection) {
                        disabledline.connection = copyObj(mLines[0].connection);
                    } else {
                        throw Error("missing connection attribute from sdp");
                    }
                } else {
                    disabledline.connection = copyObj(session.connection);
                }
                disabledline.connection.ip = "0.0.0.0";

                mLines.push(disabledline);
                console.log("added disabled m line to the media");
            }
            else {
                for(var i = 0; i < mLines.length; i ++) {
                    var typeref = mLines[i];
                    //check if we have any lines of the same type in the current answer to
                    // build this new line from.
                    if(typeref.type === remoteline.type) {
                        var linecopy = copyObj(typeref);
                        linecopy.mid = remoteline.mid;
                        linecopy.direction = "recvonly";
                        mLines.push(linecopy);
                        break;
                    }
                }
            }
        });
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
    return new window.RTCSessionDescription({
            type: desc.type,
            sdp: resStr
        }
    );
};