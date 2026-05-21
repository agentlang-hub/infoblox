const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const app = express();
const PORT = process.env.PORT || 3005;

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan("combined"));
app.use(express.json());

// Basic Authentication middleware
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Basic ")) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const credentials = Buffer.from(
    authHeader.split(" ")[1],
    "base64",
  ).toString();
  const [username, password] = credentials.split(":");

  if (username !== "admin" || password !== "infoblox") {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  next();
};

// In-memory storage
let networks = [];
let dnsRecords = {
  host: [],
  a: [],
  aaaa: [],
  cname: [],
  alias: [],
  mx: [],
  txt: [],
  ptr: [],
};

// Generate a WAPI-style _ref: "<type>/<b64>:<key>/<view>"
const generateRef = (type, key, view = "default") => {
  const internal = Buffer.from(`${type}$.${view}.${key}.${Math.random()}`)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `${type}/${internal}:${key}/${view}`;
};

// Filter records by query params (returns [] if no match)
const filterRecords = (records, query) => {
  const keys = Object.keys(query);
  if (keys.length === 0) return records;
  return records.filter((record) =>
    keys.every((key) => String(record[key]) === String(query[key])),
  );
};

// Validators
const isValidIPv4 = (ip) => {
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipv4Regex.test(ip)) return false;
  const parts = ip.split(".");
  return parts.every((part) => parseInt(part) >= 0 && parseInt(part) <= 255);
};

const isValidIPv6 = (ip) => {
  const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
  return ipv6Regex.test(ip);
};

const isValidDomain = (domain) => {
  const domainRegex =
    /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return domainRegex.test(domain);
};

const isValidCIDR = (cidr) => {
  const cidrRegex = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
  if (!cidrRegex.test(cidr)) return false;
  const [ip, prefix] = cidr.split("/");
  return isValidIPv4(ip) && parseInt(prefix) >= 0 && parseInt(prefix) <= 32;
};

const conflictError = (recordName, type) => ({
  Error: `AdmConDataError: IB.Data.ConflictError: This record already exists (record name: ${recordName}, type: ${type})`,
  code: "Client.Ibap.Data.Conflict",
  text: `This record already exists (record name: ${recordName}, type: ${type})`,
});

// Pool of random WAPI-style error responses used when ERROR_MODE is enabled
const randomErrors = [
  {
    Error: "AdmConDataNotFoundError: Zone does not exist",
    code: "Client.Ibap.Data.NotFound",
    text: "Cannot find authoritative zone",
  },
  {
    Error: "AdmConProtoError: Invalid canonical name",
    code: "Client.Ibap.Proto",
    text: "Invalid value for field 'canonical'",
  },
  {
    Error: "AdmConDataError: IB.Data.ConflictError: Object already exists",
    code: "Client.Ibap.Data.Conflict",
    text: "The record could not be created because it conflicts with an existing object",
  },
  {
    Error: "AdmConProtoError: Missing required field",
    code: "Client.Ibap.Proto",
    text: "A required field is missing from the request",
  },
  {
    Error: "AdmConServerError: Internal server error",
    code: "Server.Ibap.Internal",
    text: "An unexpected error occurred while processing the request",
  },
  {
    Error: "AdmConAuthError: Insufficient permissions",
    code: "Client.Ibap.Auth",
    text: "User does not have permission to perform this operation",
  },
  {
    Error: "AdmConDataError: IB.Data.InvalidReference: Object not found",
    code: "Client.Ibap.Data.NotFound",
    text: "The referenced object does not exist",
  },
  {
    Error: "AdmConProtoError: Invalid IP address",
    code: "Client.Ibap.Proto",
    text: "The provided IP address is not valid",
  },
];

const errorModeMiddleware = (req, res, next) => {
  if (process.env.ERROR_MODE && req.method === "POST") {
    const err = randomErrors[Math.floor(Math.random() * randomErrors.length)];
    return res.status(400).json(err);
  }
  next();
};

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "healthy", timestamp: new Date().toISOString() });
});

// WAPI v2.13.1 routes
const wapiBase = "/wapi/v2.13.1";

// Inject random WAPI errors on create when ERROR_MODE is enabled
app.use(wapiBase, errorModeMiddleware);

// ---------- Network ----------
app.get(`${wapiBase}/network`, authenticate, (req, res) => {
  res.json(filterRecords(networks, req.query));
});

app.post(`${wapiBase}/network`, authenticate, (req, res) => {
  const { network } = req.body;

  if (!network || !isValidCIDR(network)) {
    return res.status(400).json({ error: "Valid network CIDR is required" });
  }

  if (networks.find((n) => n.network === network)) {
    return res.status(400).json({
      Error: `AdmConDataError: IB.Data.ConflictError: This network already exists (network: ${network})`,
      code: "Client.Ibap.Data.Conflict",
      text: `This network already exists (network: ${network})`,
    });
  }

  const _ref = generateRef("network", network);
  const newNetwork = { _ref, network, network_view: "default" };
  networks.push(newNetwork);

  res.status(201).json(_ref);
});

app.get(`${wapiBase}/network/*`, authenticate, (req, res) => {
  const fullRef = `network/${req.params[0]}`;
  const network = networks.find((n) => n._ref === fullRef);
  if (!network) return res.status(404).json({ error: "Network not found" });
  res.json(network);
});

app.delete(`${wapiBase}/network/*`, authenticate, (req, res) => {
  const fullRef = `network/${req.params[0]}`;
  const idx = networks.findIndex((n) => n._ref === fullRef);
  if (idx === -1) return res.status(404).json({ error: "Network not found" });
  networks.splice(idx, 1);
  res.status(200).json(fullRef);
});

const urlHost = "/wapi/v2.13.1/record\\:host";
const urlA = "/wapi/v2.13.1/record\\:a";
const urlAaaa = "/wapi/v2.13.1/record\\:aaaa";
const urlCname = "/wapi/v2.13.1/record\\:cname";
const urlAlias = "/wapi/v2.13.1/record\\:alias";
const urlMx = "/wapi/v2.13.1/record\\:mx";
const urlTxt = "/wapi/v2.13.1/record\\:txt";
const urlPtr = "/wapi/v2.13.1/record\\:ptr";

// ---------- Host records ----------
app.get(urlHost, authenticate, (req, res) => {
  res.json(filterRecords(dnsRecords.host, req.query));
});

app.post(urlHost, authenticate, (req, res) => {
  const { name, ipv4addr, ipv6addr } = req.body;

  if (!name || (!ipv4addr && !ipv6addr)) {
    return res.status(400).json({
      error: "Host records require name and either ipv4addr or ipv6addr",
    });
  }
  if (!isValidDomain(name)) {
    return res.status(400).json({ error: "Invalid domain name" });
  }
  if (ipv4addr && !isValidIPv4(ipv4addr)) {
    return res.status(400).json({ error: "Invalid IPv4 address" });
  }
  if (ipv6addr && !isValidIPv6(ipv6addr)) {
    return res.status(400).json({ error: "Invalid IPv6 address" });
  }

  const existing = dnsRecords.host.find(
    (r) =>
      r.name === name &&
      ((ipv4addr && r.ipv4addr === ipv4addr) ||
        (ipv6addr && r.ipv6addr === ipv6addr)),
  );
  if (existing) {
    return res.status(400).json(conflictError(name, ipv4addr ? "A" : "AAAA"));
  }

  const _ref = generateRef("record:host", name);
  const newRecord = {
    _ref,
    name,
    ipv4addr: ipv4addr || null,
    ipv6addr: ipv6addr || null,
    view: "default",
  };
  dnsRecords.host.push(newRecord);
  res.status(201).json(_ref);
});

app.get(`${urlHost}/*`, authenticate, (req, res) => {
  const fullRef = `record:host/${req.params[0]}`;
  const record = dnsRecords.host.find((r) => r._ref === fullRef);
  if (!record) return res.status(404).json({ error: "Host record not found" });
  res.json(record);
});

app.delete(`${urlHost}/*`, authenticate, (req, res) => {
  const fullRef = `record:host/${req.params[0]}`;
  const idx = dnsRecords.host.findIndex((r) => r._ref === fullRef);
  if (idx === -1)
    return res.status(404).json({ error: "Host record not found" });
  dnsRecords.host.splice(idx, 1);
  res.status(200).json(fullRef);
});

// ---------- A records ----------
app.get(urlA, authenticate, (req, res) => {
  res.json(filterRecords(dnsRecords.a, req.query));
});

app.post(urlA, authenticate, (req, res) => {
  const { name, ipv4addr } = req.body;

  if (!name || !ipv4addr) {
    return res
      .status(400)
      .json({ error: "A records require both name and ipv4addr" });
  }
  if (!isValidDomain(name)) {
    return res.status(400).json({ error: "Invalid domain name" });
  }
  if (!isValidIPv4(ipv4addr)) {
    return res.status(400).json({ error: "Invalid IPv4 address" });
  }

  if (dnsRecords.a.find((r) => r.name === name && r.ipv4addr === ipv4addr)) {
    return res.status(400).json(conflictError(name, "A"));
  }

  const _ref = generateRef("record:a", name);
  const newRecord = { _ref, name, ipv4addr, view: "default" };
  dnsRecords.a.push(newRecord);
  res.status(201).json(_ref);
});

app.get(`${urlA}/*`, authenticate, (req, res) => {
  const fullRef = `record:a/${req.params[0]}`;
  const record = dnsRecords.a.find((r) => r._ref === fullRef);
  if (!record) return res.status(404).json({ error: "A record not found" });
  res.json(record);
});

app.delete(`${urlA}/*`, authenticate, (req, res) => {
  const fullRef = `record:a/${req.params[0]}`;
  const idx = dnsRecords.a.findIndex((r) => r._ref === fullRef);
  if (idx === -1) return res.status(404).json({ error: "A record not found" });
  dnsRecords.a.splice(idx, 1);
  res.status(200).json(fullRef);
});

// ---------- AAAA records ----------
app.get(urlAaaa, authenticate, (req, res) => {
  res.json(filterRecords(dnsRecords.aaaa, req.query));
});

app.post(urlAaaa, authenticate, (req, res) => {
  const { name, ipv6addr } = req.body;

  if (!name || !ipv6addr) {
    return res
      .status(400)
      .json({ error: "AAAA records require both name and ipv6addr" });
  }
  if (!isValidDomain(name)) {
    return res.status(400).json({ error: "Invalid domain name" });
  }
  if (!isValidIPv6(ipv6addr)) {
    return res.status(400).json({ error: "Invalid IPv6 address" });
  }

  if (dnsRecords.aaaa.find((r) => r.name === name && r.ipv6addr === ipv6addr)) {
    return res.status(400).json(conflictError(name, "AAAA"));
  }

  const _ref = generateRef("record:aaaa", name);
  const newRecord = { _ref, name, ipv6addr, view: "default" };
  dnsRecords.aaaa.push(newRecord);
  res.status(201).json(_ref);
});

app.get(`${urlAaaa}/*`, authenticate, (req, res) => {
  const fullRef = `record:aaaa/${req.params[0]}`;
  const record = dnsRecords.aaaa.find((r) => r._ref === fullRef);
  if (!record) return res.status(404).json({ error: "AAAA record not found" });
  res.json(record);
});

app.delete(`${urlAaaa}/*`, authenticate, (req, res) => {
  const fullRef = `record:aaaa/${req.params[0]}`;
  const idx = dnsRecords.aaaa.findIndex((r) => r._ref === fullRef);
  if (idx === -1)
    return res.status(404).json({ error: "AAAA record not found" });
  dnsRecords.aaaa.splice(idx, 1);
  res.status(200).json(fullRef);
});

// ---------- CNAME records ----------
app.get(urlCname, authenticate, (req, res) => {
  res.json(filterRecords(dnsRecords.cname, req.query));
});

app.post(urlCname, authenticate, (req, res) => {
  const { name, canonical } = req.body;

  if (!name || !canonical) {
    return res
      .status(400)
      .json({ error: "CNAME records require both name and canonical" });
  }
  if (!isValidDomain(name) || !isValidDomain(canonical)) {
    return res.status(400).json({ error: "Invalid domain name" });
  }

  if (
    dnsRecords.cname.find((r) => r.name === name && r.canonical === canonical)
  ) {
    return res.status(400).json(conflictError(name, "CNAME"));
  }

  const _ref = generateRef("record:cname", name);
  const newRecord = { _ref, name, canonical, view: "default" };
  dnsRecords.cname.push(newRecord);
  res.status(201).json(_ref);
});

app.get(`${urlCname}/*`, authenticate, (req, res) => {
  const fullRef = `record:cname/${req.params[0]}`;
  const record = dnsRecords.cname.find((r) => r._ref === fullRef);
  if (!record) return res.status(404).json({ error: "CNAME record not found" });
  res.json(record);
});

app.delete(`${urlCname}/*`, authenticate, (req, res) => {
  const fullRef = `record:cname/${req.params[0]}`;
  const idx = dnsRecords.cname.findIndex((r) => r._ref === fullRef);
  if (idx === -1)
    return res.status(404).json({ error: "CNAME record not found" });
  dnsRecords.cname.splice(idx, 1);
  res.status(200).json(fullRef);
});

// ---------- ALIAS records ----------
// Unlike CNAME, an ALIAS carries `target_type` (which kind of record
// the target_name resolves to: A / AAAA / MX / etc.). target_type
// defaults to "A" when callers omit it — the most common ticketflow
// case (zone-apex / TLD pointing to a load-balancer FQDN whose
// resolution is an A record).
const ALIAS_TARGET_TYPES = [
  "A",
  "AAAA",
  "MX",
  "NAPTR",
  "PTR",
  "SPF",
  "SRV",
  "TXT",
];

app.get(urlAlias, authenticate, (req, res) => {
  res.json(filterRecords(dnsRecords.alias, req.query));
});

app.post(urlAlias, authenticate, (req, res) => {
  const { name, target_name } = req.body;
  const target_type = req.body.target_type || "A";

  if (!name || !target_name) {
    return res
      .status(400)
      .json({ error: "ALIAS records require both name and target_name" });
  }
  if (!isValidDomain(name) || !isValidDomain(target_name)) {
    return res.status(400).json({ error: "Invalid domain name" });
  }
  if (!ALIAS_TARGET_TYPES.includes(target_type)) {
    return res
      .status(400)
      .json({
        error: `Invalid target_type; must be one of ${ALIAS_TARGET_TYPES.join(", ")}`,
      });
  }

  if (
    dnsRecords.alias.find(
      (r) => r.name === name && r.target_name === target_name,
    )
  ) {
    return res.status(400).json(conflictError(name, "ALIAS"));
  }

  const _ref = generateRef("record:alias", name);
  const newRecord = { _ref, name, target_name, target_type, view: "default" };
  dnsRecords.alias.push(newRecord);
  res.status(201).json(_ref);
});

app.get(`${urlAlias}/*`, authenticate, (req, res) => {
  const fullRef = `record:alias/${req.params[0]}`;
  const record = dnsRecords.alias.find((r) => r._ref === fullRef);
  if (!record) return res.status(404).json({ error: "ALIAS record not found" });
  res.json(record);
});

app.delete(`${urlAlias}/*`, authenticate, (req, res) => {
  const fullRef = `record:alias/${req.params[0]}`;
  const idx = dnsRecords.alias.findIndex((r) => r._ref === fullRef);
  if (idx === -1)
    return res.status(404).json({ error: "ALIAS record not found" });
  dnsRecords.alias.splice(idx, 1);
  res.status(200).json(fullRef);
});

// ---------- MX records ----------
app.get(urlMx, authenticate, (req, res) => {
  res.json(filterRecords(dnsRecords.mx, req.query));
});

app.post(urlMx, authenticate, (req, res) => {
  const { name, preference, mail_exchanger } = req.body;

  if (!name || preference === undefined || !mail_exchanger) {
    return res.status(400).json({
      error: "MX records require name, preference, and mail_exchanger",
    });
  }
  if (!isValidDomain(name) || !isValidDomain(mail_exchanger)) {
    return res.status(400).json({ error: "Invalid domain name" });
  }
  if (typeof preference !== "number" || preference < 0) {
    return res
      .status(400)
      .json({ error: "Preference must be a non-negative number" });
  }

  if (
    dnsRecords.mx.find(
      (r) =>
        r.name === name &&
        r.mail_exchanger === mail_exchanger &&
        r.preference === preference,
    )
  ) {
    return res.status(400).json(conflictError(name, "MX"));
  }

  const _ref = generateRef("record:mx", name);
  const newRecord = { _ref, name, preference, mail_exchanger, view: "default" };
  dnsRecords.mx.push(newRecord);
  res.status(201).json(_ref);
});

app.get(`${urlMx}/*`, authenticate, (req, res) => {
  const fullRef = `record:mx/${req.params[0]}`;
  const record = dnsRecords.mx.find((r) => r._ref === fullRef);
  if (!record) return res.status(404).json({ error: "MX record not found" });
  res.json(record);
});

app.delete(`${urlMx}/*`, authenticate, (req, res) => {
  const fullRef = `record:mx/${req.params[0]}`;
  const idx = dnsRecords.mx.findIndex((r) => r._ref === fullRef);
  if (idx === -1) return res.status(404).json({ error: "MX record not found" });
  dnsRecords.mx.splice(idx, 1);
  res.status(200).json(fullRef);
});

// ---------- TXT records ----------
app.get(urlTxt, authenticate, (req, res) => {
  res.json(filterRecords(dnsRecords.txt, req.query));
});

app.post(urlTxt, authenticate, (req, res) => {
  const { name, text } = req.body;

  if (!name || !text) {
    return res
      .status(400)
      .json({ error: "TXT records require both name and text" });
  }
  if (!isValidDomain(name)) {
    return res.status(400).json({ error: "Invalid domain name" });
  }

  if (dnsRecords.txt.find((r) => r.name === name && r.text === text)) {
    return res.status(400).json(conflictError(name, "TXT"));
  }

  const _ref = generateRef("record:txt", name);
  const newRecord = { _ref, name, text, view: "default" };
  dnsRecords.txt.push(newRecord);
  res.status(201).json(_ref);
});

app.get(`${urlTxt}/*`, authenticate, (req, res) => {
  const fullRef = `record:txt/${req.params[0]}`;
  const record = dnsRecords.txt.find((r) => r._ref === fullRef);
  if (!record) return res.status(404).json({ error: "TXT record not found" });
  res.json(record);
});

app.delete(`${urlTxt}/*`, authenticate, (req, res) => {
  const fullRef = `record:txt/${req.params[0]}`;
  const idx = dnsRecords.txt.findIndex((r) => r._ref === fullRef);
  if (idx === -1)
    return res.status(404).json({ error: "TXT record not found" });
  dnsRecords.txt.splice(idx, 1);
  res.status(200).json(fullRef);
});

// ---------- PTR records ----------
app.get(urlPtr, authenticate, (req, res) => {
  res.json(filterRecords(dnsRecords.ptr, req.query));
});

app.post(urlPtr, authenticate, (req, res) => {
  const { ptrdname, ipv4addr } = req.body;

  if (!ptrdname || !ipv4addr) {
    return res
      .status(400)
      .json({ error: "PTR records require both ptrdname and ipv4addr" });
  }
  if (!isValidDomain(ptrdname)) {
    return res.status(400).json({ error: "Invalid domain name" });
  }
  if (!isValidIPv4(ipv4addr)) {
    return res.status(400).json({ error: "Invalid IPv4 address" });
  }

  if (
    dnsRecords.ptr.find(
      (r) => r.ptrdname === ptrdname && r.ipv4addr === ipv4addr,
    )
  ) {
    return res.status(400).json(conflictError(ptrdname, "PTR"));
  }

  const _ref = generateRef("record:ptr", ptrdname);
  const newRecord = { _ref, ptrdname, ipv4addr, view: "default" };
  dnsRecords.ptr.push(newRecord);
  res.status(201).json(_ref);
});

app.get(`${urlPtr}/*`, authenticate, (req, res) => {
  const fullRef = `record:ptr/${req.params[0]}`;
  const record = dnsRecords.ptr.find((r) => r._ref === fullRef);
  if (!record) return res.status(404).json({ error: "PTR record not found" });
  res.json(record);
});

app.delete(`${urlPtr}/*`, authenticate, (req, res) => {
  const fullRef = `record:ptr/${req.params[0]}`;
  const idx = dnsRecords.ptr.findIndex((r) => r._ref === fullRef);
  if (idx === -1)
    return res.status(404).json({ error: "PTR record not found" });
  dnsRecords.ptr.splice(idx, 1);
  res.status(200).json(fullRef);
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Something went wrong!" });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Endpoint not found" });
});

// Start server
app.listen(PORT, () => {
  console.log(`Infoblox Mock Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`WAPI endpoint: http://localhost:${PORT}/wapi/v2.13.1`);
});

module.exports = app;
