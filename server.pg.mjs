// Compatibility shim.
//
// Docker used to run this file, and it had drifted from server.mjs into a
// second, broken implementation. There is now one server; this path just starts
// it, so an existing Dokploy service pointed at server.pg.mjs keeps working.

import './server.mjs';
