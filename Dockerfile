# --- Build Stage ---
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package.json and package-lock.json first to leverage Docker cache
COPY package*.json ./

# Install dependencies using npm ci (clean install for predictable builds)
RUN npm ci

# Copy the rest of the application source code
COPY . .

# Build the Vite application for production
# This command will automatically bake the VITE_ environment variables into the static bundle
RUN npm run build

# --- Production Stage ---
FROM nginx:alpine

# Copy custom Nginx configuration to handle SPA routing
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy the build output from the 'builder' stage to Nginx's serving directory
COPY --from=builder /app/dist /usr/share/nginx/html

# Expose port 80 for the Nginx server
EXPOSE 80

# Start Nginx
CMD ["nginx", "-g", "daemon off;"]
