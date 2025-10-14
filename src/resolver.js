const al_integmanager = await import(`${process.cwd()}/node_modules/agentlang/out/runtime/integrations.js`)

function getConfig(k) {
    return al_integmanager.getIntegrationConfig('infoblox', k)
}

const getResponseBody = async (response) => {
    try {
        try {
            return await response.json()
        } catch (e) {
            return await response.text();
        }
    } catch (error) {
        console.error("INFOBLOX RESOLVER: Error reading response body:", error);
        return {};
    }
}

// Generic HTTP functions
const makeRequest = async (endpoint, options = {}) => {
    const baseUrl = getConfig('baseUrl') || process.env.INFOBLOX_BASE_URL
    const user = getConfig('user') || process.env.INFOBLOX_USERNAME
    const password = getConfig('password') || process.env.INFOBLOX_PASSWORD
    const authHeader = 'Basic ' + btoa(`${user}:${password}`)
    
    const url = `${baseUrl}${endpoint}`;
    const defaultOptions = {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': authHeader
        }
    };

    console.log(`INFOBLOX RESOLVER: making http request ${options.method} ${url} with options ${JSON.stringify(options)}`)

    const config = { ...defaultOptions, ...options };
    
    // Remove Content-Type header for GET requests without body
    if (config.method === 'GET') {
        delete config.headers['Content-Type'];
    }

    const timeoutMs = 30000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        console.error(`INFOBLOX RESOLVER: Request timeout after ${timeoutMs}ms - ${url} - ${JSON.stringify(options)}`);
        controller.abort();
    }, timeoutMs);

    try {
            const response = await fetch(url, {
                ...config,
                signal: controller.signal
            });

            const body = await getResponseBody(response);
            console.log(`INFOBLOX RESOLVER: response ${response.status} ${response.ok}`, body)
        
        clearTimeout(timeoutId);

        if (response.status != 201 && response.status != 200) {
            if (body.code == 'Client.Ibap.Data.Conflict') {
                throw new Error(JSON.stringify(body));
            }
            throw new Error(`HTTP Error: ${JSON.stringify(response)}`);
        }    

        if (!response.ok) {
            console.error(`INFOBLOX RESOLVER: HTTP Error ${response.status} - ${url} - ${JSON.stringify(options)}`);
            throw error;
        }

        return body;

    } catch (error) {
        clearTimeout(timeoutId);
        
        if (error.name === 'AbortError') {
            console.error(`INFOBLOX RESOLVER: Request timeout - ${url} - ${JSON.stringify(options)}`);
        } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.code === 'EHOSTUNREACH') {
            console.error(`INFOBLOX RESOLVER: Network unreachable (${error.code}) - ${url} - ${JSON.stringify(options)}`);
        } else if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
            console.error(`INFOBLOX RESOLVER: Connection error (${error.code}) - ${url} - ${JSON.stringify(options)}`);
        } else {
            console.error(`INFOBLOX RESOLVER: Request failed (${error.name}) - ${url} - ${JSON.stringify(options)}`);
        }
        
        throw error;
    }
};

const makeGetRequest = async (endpoint) => {
    console.log(`INFOBLOX RESOLVER: Querying DNS Entries: ${endpoint}\n`);    
    return await makeRequest(endpoint, { method: 'GET' });
};

const makePostRequest = async (endpoint, body) => {
    console.log(`INFOBLOX RESOLVER: Creating a new DNS Entry: ${endpoint}\n`);

    return await makeRequest(endpoint, {
        method: 'POST',
        body: JSON.stringify(body)
    });
};

const makePatchRequest = async (endpoint, body) => {
    console.log(`INFOBLOX RESOLVER: Updating a DNS Entry: ${endpoint}\n`);
    const response = await makeRequest(endpoint, {
        method: 'PATCH',
        body: JSON.stringify(body)
    });

    if (response.status != 201 && response.status != 200) {
        throw new Error(`HTTP Error: ${JSON.stringify(response)}`);
    }

    return response;
};

// AAAA Record functions
export const createAAAA = async (env, attributes) => {
    const data = {
        name: attributes.attributes.get('name'),
        ipv6addr: attributes.attributes.get('ipv6addr')
    };

    try {
        const existingRecords = await makeGetRequest('/record:aaaa?name=' + data.name);
        let existingRecord; 
        
        if (typeof existingRecords === 'array') {
            existingRecord = existingRecords.find(record => 
                record.name === data.name && record.ipv6addr === data.ipv6addr
            );
        } else {
            existingRecord = existingRecords;
        }

        if (existingRecord && existingRecord._ref) {
            return {"result": "error", "code": "AlreadyExists"};
        }

        const result = await makePostRequest('/record:aaaa', data);
        return {"result": "success"};
    } catch (error) {
        console.error(`INFOBLOX RESOLVER: Failed to create AAAA record:`, error.message);
        try {
            const e = JSON.parse(error.message)
            
            // Check if it's a conflict error from the API
            if (e.code === 'Client.Ibap.Data.Conflict' || 
                (error.message && error.message.includes('ConflictError'))) {
                return {"result": "error", "code": "AlreadyExists"};
            }
        }
        catch (error) {
            return {"result": "error", "code": "other"};
        }
        
        return {"result": "error", "code": "other"};
    }
};

export const queryAAAA = async (env, id) => {
    try {
        return await makeGetRequest('/record:aaaa');
    } catch (error) {
        console.error(`INFOBLOX RESOLVER: Failed to query AAAA records: ${error}`);
        return {"result": "error", "code": "other"};
    }
};

// CNAME Record functions
export const createCNAME = async (env, attributes) => {
    const data = {
        name: attributes.attributes.get('name'),
        canonical: attributes.attributes.get('canonical')
    };

    try {
        const existingRecords = await makeGetRequest('/record:cname?name=' + data.name);
        let existingRecord; 
        
        if (typeof existingRecords === 'array') {
            existingRecord = existingRecords.find(record => 
                record.name === data.name && record.canonical === data.canonical
            );
        } else {
            existingRecord = existingRecords;
        }

        if (existingRecord && existingRecord._ref) {
            return {"result": "error", "code": "AlreadyExists"};
        }

        const result = await makePostRequest('/record:cname', data);
        return {"result": "success"};
    } catch (error) {
        console.error(`INFOBLOX RESOLVER: Failed to create/update CNAME record:`, error.message);
        try {
            const e = JSON.parse(error.message)
            
            // Check if it's a conflict error from the API
            if (e.code === 'Client.Ibap.Data.Conflict' || 
                (error.message && error.message.includes('ConflictError'))) {
                return {"result": "error", "code": "AlreadyExists"};
            }
        }
        catch (error) {
            return {"result": "error", "code": "other"};
        }
        
        return {"result": "error", "code": "other"};
    }
};

export const queryCNAME = async (env, name) => {
    try {
        return await makeGetRequest('/record:cname');
    } catch (error) {
        console.error(`INFOBLOX RESOLVER: Failed to query CNAME records: ${error}`);
        return {"result": "error", "code": "other"};
    }
};

// MX Record functions
export const createMX = async (env, attributes) => {
    const data = {
        name: attributes.attributes.get('name'),
        preference: parseInt(attributes.attributes.get('preference')),
        mail_exchanger: attributes.attributes.get('mail_exchanger')
    };

    try {
        const existingRecords = await makeGetRequest('/record:mx?name=' + data.name);
        let existingRecord; 
        
        if (typeof existingRecords === 'array') {
            existingRecord = existingRecords.find(record => 
                record.name === data.name && record.mail_exchanger === data.mail_exchanger && record.preference === data.preference
            );
        } else {
            existingRecord = existingRecords;
        }

        if (existingRecord && existingRecord._ref) {
            return {"result": "error", "code": "AlreadyExists"};
        }

        const result = await makePostRequest('/record:mx', data);
        return {"result": "success"};
    } catch (error) {
        console.error(`INFOBLOX RESOLVER: Failed to create MX record:`, error.message);
        try {
            const e = JSON.parse(error.message)
            
            // Check if it's a conflict error from the API
            if (e.code === 'Client.Ibap.Data.Conflict' || 
                (error.message && error.message.includes('ConflictError'))) {
                return {"result": "error", "code": "AlreadyExists"};
            }
        }
        catch (error) {
            return {"result": "error", "code": "other"};
        }
        
        return {"result": "error", "code": "other"};
    }
};

export const queryMX = async (env, name) => {
    try {
        return await makeGetRequest('/record:mx');
    } catch (error) {
        console.error(`INFOBLOX RESOLVER: Failed to query MX records: ${error}`);
        return {"result": "error", "code": "other"};
    }
};

// HOST Record functions
export const createHost = async (env, attributes) => {
    const data = {
        name: attributes.attributes.get('name'),
        ipv4addr: attributes.attributes.get('ipv4addr'),
        ipv6addr: attributes.attributes.get('ipv6addr')
    };

    try {
        const existingRecords = await makeGetRequest('/record:host?name=' + data.name);
        let existingRecord; 
        
        if (typeof existingRecords === 'array') {
            existingRecord = existingRecords.find(record => 
                record.name === data.name && 
                ((data.ipv4addr && record.ipv4addr === data.ipv4addr) || (data.ipv6addr && record.ipv6addr === data.ipv6addr))
            );
        } else {
            existingRecord = existingRecords;
        }

        if (existingRecord && existingRecord._ref) {
            return {"result": "error", "code": "AlreadyExists"};
        }

        const result = await makePostRequest('/record:host', data);
        return {"result": "success"};
    } catch (error) {
        console.error(`INFOBLOX RESOLVER: Failed to create HOST record:`, error.message);
        try {
            const e = JSON.parse(error.message)
            
            // Check if it's a conflict error from the API
            if (e.code === 'Client.Ibap.Data.Conflict' || 
                (error.message && error.message.includes('ConflictError'))) {
                return {"result": "error", "code": "AlreadyExists"};
            }
        }
        catch (error) {
            return {"result": "error", "code": "other"};
        }
        
        return {"result": "error", "code": "other"};
    }
};

export const queryHost = async (env, name) => {
    try {
        return await makeGetRequest('/record:host');
    } catch (error) {
        console.error(`INFOBLOX RESOLVER: Failed to query HOST records: ${error}`);
        return {"result": "error", "code": "other"};
    }
};

// TXT Record functions
export const createTXT = async (env, attributes) => {
    const data = {
        name: attributes.attributes.get('name'),
        text: attributes.attributes.get('text')
    };

    try {
        const existingRecords = await makeGetRequest('/record:txt?name=' + data.name);
        let existingRecord; 
        
        if (typeof existingRecords === 'array') {
            existingRecord = existingRecords.find(record => 
                record.name === data.name && record.text === data.text
            );
        } else {
            existingRecord = existingRecords;
        }

        if (existingRecord && existingRecord._ref) {
            return {"result": "error", "code": "AlreadyExists"};
        }

        await makePostRequest('/record:txt', data);
        return {"result": "success"};
    } catch (error) {
        console.error(`INFOBLOX RESOLVER: Failed to create TXT record:`, error.message);
        try {
            const e = JSON.parse(error.message)
            
            // Check if it's a conflict error from the API
            if (e.code === 'Client.Ibap.Data.Conflict' || 
                (error.message && error.message.includes('ConflictError'))) {
                return {"result": "error", "code": "AlreadyExists"};
            }
        }
        catch (error) {
            return {"result": "error", "code": "other"};
        }
        
        return {"result": "error", "code": "other"};
    }
};

export const queryTXT = async (env, name) => {
    try {
        return await makeGetRequest('/record:txt');
    } catch (error) {
        console.error(`INFOBLOX RESOLVER: Failed to query TXT records: ${error}`);
        return {"result": "error", "code": "other"};
    }
};

// PTR Record functions
export const createPTR = async (env, attributes) => {
    const data = {
        ptrdname: attributes.attributes.get('ptrdname'),
        ipv4addr: attributes.attributes.get('ipv4addr')
    };

    try {
        const existingRecords = await makeGetRequest('/record:ptr?ptrdname=' + data.ptrdname);
        let existingRecord; 
        
        if (typeof existingRecords === 'array') {
            existingRecord = existingRecords.find(record => 
                record.ptrdname === data.ptrdname && record.ipv4addr === data.ipv4addr
            );
        } else {
            existingRecord = existingRecords;
        }

        if (existingRecord && existingRecord._ref) {
            return {"result": "error", "code": "AlreadyExists"};
        }

        const result = await makePostRequest('/record:ptr', data);
        return {"result": "success"};
    } catch (error) {
        console.error(`INFOBLOX RESOLVER: Failed to create PTR record:`, error.message);
        try {
            const e = JSON.parse(error.message)
            
            // Check if it's a conflict error from the API
            if (e.code === 'Client.Ibap.Data.Conflict' || 
                (error.message && error.message.includes('ConflictError'))) {
                return {"result": "error", "code": "AlreadyExists"};
            }
        }
        catch (error) {
            return {"result": "error", "code": "other"};
        }
        
        return {"result": "error", "code": "other"};
    }
};

export const queryPTR = async (env, name) => {
    try {
        return await makeGetRequest('/record:ptr');
    } catch (error) {
        console.error(`INFOBLOX RESOLVER: Failed to query PTR records: ${error}`);
        return {"result": "error", "code": "other"};
    }
};

// Network functions
export const createNetwork = async (env, attributes) => {
    const data = {
        network: attributes.attributes.get('network')
    };

    try {
        const existingRecords = await makeGetRequest('/network?network=' + data.network);
        let existingRecord; 
        
        if (typeof existingRecords === 'array') {
            existingRecord = existingRecords.find(record => 
                record.network === data.network
            );
        } else {
            existingRecord = existingRecords;
        }

        if (existingRecord && existingRecord._ref) {
            return {"result": "error", "code": "AlreadyExists"};
        }

        const result = await makePostRequest('/network', data);
        return {
            "result": "success"
        };
    } catch (error) {
        console.error(`INFOBLOX RESOLVER: Failed to create network:`, error.message);
        try {
            const e = JSON.parse(error.message)
            
            // Check if it's a conflict error from the API
            if (e.code === 'Client.Ibap.Data.Conflict' || 
                (error.message && error.message.includes('ConflictError'))) {
                return {"result": "error", "code": "AlreadyExists"};
            }
        }
        catch (error) {
            return {"result": "error", "code": "other"};
        }
        
        return {"result": "error", "code": "other"};
    }
};

export const queryNetwork = async (env, id) => {
    try {
        if (id) {
            return await makeRequest(`/network/${id}`, { method: 'GET' });
        } else {
            return await makeGetRequest('/network');
        }
    } catch (error) {
        console.error(`INFOBLOX RESOLVER: Failed to query network: ${error}`);
        return {"result": "error", "code": "other"};
    }
};

