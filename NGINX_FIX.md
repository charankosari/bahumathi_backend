# Nginx Configuration Fix for Large File Uploads

## Problem

Videos and large files are failing to upload because nginx has a default `client_max_body_size` of **1MB**, which is too small for video uploads.

## Solution

Add `client_max_body_size` directive to your nginx configuration file.

### Update your nginx configuration

Edit your nginx config file (usually at `/etc/nginx/sites-available/server.bahumati.in` or similar):

```nginx
server {
    server_name server.bahumati.in;

    # ⚠️ ADD THIS LINE - Allows uploads up to 50MB
    client_max_body_size 50M;
    client_body_timeout 300s;
    client_body_buffer_size 128k;

    location / {
        proxy_pass http://localhost:4000;

        # --- WebSocket Support ---
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";

        # --- Headers ---
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # ⚠️ ALSO ADD THESE for file uploads
        proxy_request_buffering off;
        proxy_read_timeout 300s;
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
    }

    listen 443 ssl;
    ssl_certificate /etc/letsencrypt/live/server.bahumati.in/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/server.bahumati.in/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}

server {
    if ($host = server.bahumati.in) {
        return 301 https://$host$request_uri;
    }
    server_name server.bahumati.in;
    listen 80;
    return 404;
}
```

### Steps to apply:

1. **Edit the nginx config:**

   ```bash
   sudo nano /etc/nginx/sites-available/server.bahumati.in
   ```

2. **Add the `client_max_body_size` line** inside the `server` block (right after `server_name`)

3. **Test the configuration:**

   ```bash
   sudo nginx -t
   ```

4. **Reload nginx:**
   ```bash
   sudo systemctl reload nginx
   ```

## What was fixed:

### Backend (Node.js/Express):

- ✅ Updated `app.js` to handle larger JSON payloads (`express.json({ limit: '50mb' })`)
- ✅ Multer already configured for 30MB file size limit

### Frontend (Flutter):

- ✅ Added file size validation before upload (20MB for videos, 10MB for images, 5MB for audio)
- ✅ Better error messages for upload failures
- ✅ Improved error handling

### Nginx:

- ⚠️ **YOU NEED TO ADD** `client_max_body_size 50M;` to allow large file uploads

## File Size Limits Summary:

- **Videos**: 20MB max (validated in app)
- **Images**: 10MB max (validated in app)
- **Audio**: 5MB max (validated in app)
- **Multer**: 30MB limit (backend)
- **Nginx**: Should be 50MB to allow buffer
