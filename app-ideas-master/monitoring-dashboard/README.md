# Pulse monitoring dashboard

A small, dependency-free dashboard for checking the availability and response time of HTTP API endpoints.

## Requirements

- Node.js 18 or newer
- A modern browser with JavaScript enabled

## Start

From this directory:

```sh
npm start
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173). To use another local port, set the `PORT` environment variable before starting the server.

## Use

Add up to 10 endpoints using **Add monitor**. Each endpoint is checked immediately and once per minute while this page is open. Checks use a GET request; a green result indicates an HTTP 2xx response, and the dashboard records response time, HTTP status, the last 30 results, and recent uptime. Use **Check all** or a monitor's refresh button to check on demand.

Monitor names, endpoint URLs, and check history are stored in this browser's local storage. Nothing is sent to a monitoring service or stored on the dashboard server.

## Browser limitations

Checks run in the browser, not from an external monitoring network. The endpoint must allow cross-origin requests (CORS); otherwise, the browser reports a network/CORS failure even when the API itself is available. Checks pause while this page is in the background or closed. The dashboard does not send credentials, custom headers, or non-GET requests. Use endpoints you are authorized to monitor.

## Tests

```sh
npm test
```
