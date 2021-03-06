![Facing Logo](https://raw.githubusercontent.com/manifestinteractive/facing/master/assets/logo/rectangle/logo_rectangle.jpg)

Facing Server
=============

This is a Node Server for handing communication between devices with the Facing App installed.

Starting Server
---
### Cloning Facing Server

```bash
$ cd /path/to/facing/server
$ git clone -b stable https://github.com/manifestinteractive/facing-server.git .
```

### Configuring Node

You will need Node.js and Node Package Manager (NPM) installed on your server.  Once you have these installed, you can run the following commands.

```bash
$ sudo npm install -g forever
$ cd /path/to/facing/server
$ npm install
$ forever start server.js
```

### Optional use with Nginx

```bash
$ sudo nano /etc/nginx/conf.d/facing.conf
```

```conf
upstream facing_upstream {
    server 127.0.0.1:4000 fail_timeout=120s;
    keepalive 8;
}

server {
    listen 80;
    spdy_headers_comp 3;
    server_name app.youfacing.me;
    access_log /var/log/nginx/facing_access.log;
    error_log /var/log/nginx/facing_error.log;

    location / {
        proxy_pass                  http://facing_upstream;
        proxy_redirect              off;
        proxy_buffering             off;

        proxy_set_header            Host $host;
        proxy_set_header            X-Real-IP $remote_addr;
        proxy_set_header            X-Forwarded-for $remote_addr;
        proxy_connect_timeout       120;
        proxy_send_timeout          120;
        proxy_read_timeout          180;

        proxy_http_version          1.1;
        proxy_set_header            Connection "";
    }
}
```

iOS & Android Application
---

If you would like to know what we're running on iOS & Android, checkout our [facing](https://github.com/manifestinteractive/facing) repository.

Credits
===
Special Thanks to [@tamaspiros](https://github.com/tamaspiros) for the development of the [Advanced Chat](https://github.com/tamaspiros/advanced-chat) project, which the Facing Server is heavily based on.

License
===

![OSI Approved License](http://opensource.org/trademarks/opensource/OSI-Approved-License-100x137.png "OSI Approved License")

![LGPL v3 license](http://www.gnu.org/graphics/lgplv3-147x51.png "LGPL v3 license")

**Facing** is currently licensed under the LGPL v3 license.
