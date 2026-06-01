# Jay's Air Center Website

Luxury aviation website for Jay's Air Center at John Wayne Airport (SNA). Features premium aircraft hangars, FBO services, executive office space, and tie-down facilities.

## Development

```bash
# Install dependencies
npm install

# Start development server with CSS watch
npm run dev

# Build for production
npm run build

# Serve static files only
npm run serve
```

## Deployment

### Automatic (CI/CD)

Copy `.github/workflows/deploy.yml` to the repo root's `.github/workflows/` directory to enable automatic deployment on push to `main`.

GitHub Secrets required:
- `NETLIFY_AUTH_TOKEN` - Personal access token from Netlify User Settings > Applications
- `JAC_NETLIFY_SITE_ID` - Site ID from Netlify Site Settings > General

### Manual Deployment

```bash
# Using the deploy script
./scripts/deploy.sh

# Or manually:
npm run build
npx netlify deploy --prod
```

## Structure

```
├── index.html              # Main website (single-page)
├── css/output.css          # Compiled Tailwind CSS (generated)
├── src/input.css           # Tailwind source
├── images/                 # All images and video
├── scripts/
│   └── deploy.sh           # Manual deployment script
├── .github/workflows/
│   └── deploy.yml          # GitHub Actions workflow (copy to repo root)
├── netlify.toml            # Netlify config with security headers
├── tailwind.config.js      # Tailwind configuration
└── package.json            # Build scripts
```

## Forms

Both contact and newsletter forms use Netlify Forms with honeypot spam protection. Form submissions appear in the Netlify dashboard under Forms.

## Security

Security headers configured in `netlify.toml`:
- X-Frame-Options: DENY
- X-Content-Type-Options: nosniff
- Referrer-Policy: strict-origin-when-cross-origin
- Content-Security-Policy: Restricts sources for scripts, styles, fonts, images, and frames

## Netlify Setup

1. Create new site on Netlify (import from Git or drag/drop)
2. Set build command: `npm run build`
3. Set publish directory: `.` (current directory)
4. Get Site ID from Site Settings > General
5. Forms will be automatically detected

## Contact

Jay's Air Center
2980 Airway Avenue
Costa Mesa, CA 92626
(949) 279-3177
