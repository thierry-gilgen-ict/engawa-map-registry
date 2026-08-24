FROM nginxinc/nginx-unprivileged:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html privacy.html styles.css app.js sites.js types.js /usr/share/nginx/html/

USER nginx
