module infoblox

import "resolver.js" @as ibr

entity AAAA {
    _ref String @id,
    name String @optional,
    ipv6addr String @optional,
    created_at String @optional,
    updated_at String @optional
}

entity CNAME {
    _ref String @id,
    name String @optional,
    canonical String @optional,
    created_at String @optional,
    updated_at String @optional
}

entity MX {
    _ref String @id,
    name String @optional, 
    preference Int @optional,
    mail_exchanger String @optional,
    created_at String @optional,
    updated_at String @optional
} 

entity TXT {
    _ref String @id,
    name String @optional,
    text String @optional,
    created_at String @optional,
    updated_at String @optional
}

entity PTR {
    _ref String @id,
    ptrdname String @optional,
    ipv4addr String @optional,
    created_at String @optional,
    updated_at String @optional
}

entity Host {
    _ref String @id,
    name String @optional,
    ipaddress String @optional,
    created_at String @optional,
    updated_at String @optional
}

entity Network {
    _ref String @id,
    network String @optional,
    created_at String @optional,
    updated_at String @optional
}

resolver ib1 [infoblox/AAAA] {
    create ibr.createAAAA,
    query ibr.queryAAAA,
    delete ibr.deleteAAAA
}

resolver ib2 [infoblox/CNAME] {
    create ibr.createCNAME,
    query ibr.queryCNAME,
    delete ibr.deleteCNAME
}

resolver ib3 [infoblox/MX] {
    create ibr.createMX,
    query ibr.queryMX,
    delete ibr.deleteMX
}

resolver ib4 [infoblox/TXT] {
    create ibr.createTXT,
    query ibr.queryTXT,
    delete ibr.deleteTXT
}

resolver ib5 [infoblox/PTR] {
    create ibr.createPTR,
    query ibr.queryPTR,
    delete ibr.deletePTR
}

resolver ib6 [infoblox/Host] {
    create ibr.createHost,
    query ibr.queryHost,
    delete ibr.deleteHost
}

resolver ib7 [infoblox/Network] {
    create ibr.createNetwork,
    query ibr.queryNetwork,
    delete ibr.deleteNetwork
}

agent infobloxAgent {
    llm "ticketflow_llm",
    role "You are a an app responsible for adding entities to Infoblox, given name and ip address."
    instruction "You are a an app responsible for adding entities to Infoblox, given name and ip address. Only act if instructions contain DNS. Otherwise, ignore. For instance:
                    For instruction: create dns record of type AAAA with name <name> and ipv6addr <ip>, use appropriate tool to add the host to Infoblox.
                    Infer DNS entry type between HOST, CNAME, AAAA, MX, TXT, and PTR. Fill relevant fields and use relevent tool given the type. If type not found, use host.",
    tools [infoblox/Host, infoblox/CNAME, infoblox/AAAA, infoblox/MX, infoblox/TXT, infoblox/PTR, infoblox/Network]
}

