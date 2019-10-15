var SecureWorkerInternal = require('../build/Release/secureworker_internal');
var MessagePort = require('./message-port');
var https = require('https');
const URL = require('url').Url;

var SecureWorker = function SecureWorker(enclaveName, contentKey) {
  var self = this;

  if (!(self instanceof SecureWorker)) {
    return new SecureWorker.apply(null, arguments);
  }

  self.createdCallback(enclaveName, contentKey);
};

SecureWorker._Internal = SecureWorkerInternal;

SecureWorker.prototype.createdCallback = function createdCallback(enclaveName, contentKey) {
  var self = this;

  self._eventsFromInside = new MessagePort();

  self._internal = new SecureWorker._Internal(enclaveName);

  self._internal.handlePostMessage = function (marshalledMessage) {
    var message = JSON.parse(marshalledMessage);
    setImmediate(function () {
      self._eventsFromInside.emit('message', message);
    });
  };

  self._internal.init(contentKey);
};

SecureWorker.prototype.onMessage = function onMessage(listener) {
  var self = this;

  self._eventsFromInside.addListener('message', listener);
  self._eventsFromInside.start();

  return listener;
};

SecureWorker.prototype.removeOnMessage = function (listener) {
  var self = this;

  self._eventsFromInside.removeListener('message', listener);
};

SecureWorker.prototype.postMessage = function postMessage(message) {
  var self = this;
  var marshalledMessage = JSON.stringify(message);
  // We want to simulate asynchronous messaging.
  setImmediate(function () {
    self._internal.emitMessage(marshalledMessage);
  });
};

SecureWorker.prototype.terminate = function terminate() {
  var self = this;
  setImmediate(function () {
    self._internal.close();
    self._internal = null;
  });
};

// Returns data needed for generation of a report and later on quote.
SecureWorker.initQuote = function initQuote() {
  return SecureWorker._Internal.initQuote();
};

// Extracts report data (64 bytes of extra information) from a report.
// Inputs and outputs are an arraybuffer.
SecureWorker.getReportData = function getReportData(report) {
  return report.slice(320, 320 + 64);
};

// Converts a report (something which can be checked locally) to a quote (something which
// can be checked remotely). Report should come from this machine.
// Inputs and outputs are an arraybuffer. "linkable" is a boolean.
SecureWorker.getQuote = function getQuote(report, linkable, spid, revocationList) {
  // TODO: If revocationList is not provided (undefined), fetch (and cache) the recent revocation list from Intel.
  return SecureWorker._Internal.getQuote(report, linkable, spid, revocationList);
};

// Extracts report data (64 bytes of extra information) from a quote.
// Inputs and outputs are an arraybuffer.
SecureWorker.getQuoteData = function getQuoteData(quote) {
  return quote.slice(48 + 320, 48 + 320 + 64);
};

// Do a remote attestation of a given quote. Quote can come from this or some other machine.
// Returns a signed remote attestation statement on successful remote attestation.
// Input is:
//  - an arraybuffer containing the quote
//  - the subscription key
//  - a callback function structured at function(result,err)
//  - an options object, can contain: a custom ra url, a pseManifest, and a nonce
// The RA signature is returned using the callback function as an arraybuffer
// If an error occurs, result will be undefined and err will contain a string
SecureWorker.getRemoteAttestation = function getRemoteAttestation(quote, subscriptionKey, callbackFn, options) {
  //check for error case first
  if(subscriptionKey.length === 0) {
    throw new Error("Subscription key must be provided for remote attestation");
  }

  var self=this;

  var quoteData = self.getQuoteData(quote);
  var quoteStr = String.fromCharCode.apply(null,new UInt16Array(quoteData));
  const payload = {"isvEnclaveQuote":quoteStr};

  //check for optional parameters and set update payload
  var raUrl = "https://api.trustedservices.intel.com/sgx/attestation/v3/report";
  if(options){

    if(options.url) {
      raUrl = options.url;
    }
    
    if(options.pseManifest) {
      payload.pseManifest = options.pseManifest;
    }

    if(options.nonce) {
      payload.nonce = options.nonce;
    }
    
  }

  const parsedUrl = new URL(raUrl);

  const requestObject = {
    hostname: parsedUrl.host,
    path: parsedUrl.pathname,
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": subscriptionKey
    }
  };

  const handleResponse = function(res) {
    if(res) {

      switch(res.statusCode) {

      case 200:
        
        //request successful, convert response to buffer
        var responseData = [];
        res.on('data', (datum) => {
          responseData.push(datum);
        }).on('end', (_) => {
          var responseDataBuffer = Buffer.concat(datum);
          callbackFn(responseDataBuffer);
        });

        break;

      case 400:
        callbackFn(undefined,"Bad Request: Invalid Attestation Evidence Payload");
        break;

      case 401:
        callbackFn(undefined, "Unauthorized: failed to authenticate");
        break;

      case 500:
        callbackFn(undefined, "Internal Server Error");
        break;

      case 503:
        callbackFn(undefined, "Service Unavailable");
        break;

      default:
        callbackFn(undefined, "Unknown Error - Report this");
        break;

      }

    } else{
      callbackFn(undefined, "Invalid Response");
    }
  }

  var req = https.request(requestObject, handleResponse);
  req.write(JSON.stringify(payload));
  req.end();
  return;
};

// Validates a signed remote attestation statement for a given quote.
// Input is an arraybuffer, output is true or false.
SecureWorker.validateRemoteAttestation = function validateRemoteAttestation(quote, attestation) {
  //return SecureWorker._Internal.validateRemoteAttestation(quote,attestation);
  throw new Error("Not implemented.");
};

SecureWorker.getSGXVersion = function getSGXVersion() {
  // TODO: Return real information about SGX version and version of services (and their enclaves) it provides.
  return {};
};

module.exports = SecureWorker;
