# Consilium website — setup package

## Included
- `website/index.html` — homepage
- `website/apply.html` — application form and calendar embed
- `website/styles.css` — responsive black-and-white design
- `website/config.js` — two settings you must fill before going live
- `website/apply.js` — form submission and calendar setup
- `google-apps-script/Code.gs` — Google Apps Script email receiver
- `LAUNCH-CHECKLIST.md` — launch steps

## Important: not live until configured
This package is ready to configure and deploy, but it is not connected to your Google account yet. The form intentionally refuses submissions until both `APPS_SCRIPT_URL` and `GOOGLE_BOOKING_URL` are configured. Do not publish it as a working application form before testing it.

## 1. Set up Google Calendar (free where available)
1. Sign into the Google account you want to use for Consilium.
2. Open Google Calendar on desktop.
3. Find **Appointment schedules** and create a schedule named `Consilium Introductory Meeting`.
4. Set duration to 30 minutes and choose the days/hours you want to offer.
5. Set the correct time zone and configure booking lead time, buffer, and maximum bookings to suit your availability.
6. Save and copy the public booking page link.
7. Paste it into `GOOGLE_BOOKING_URL` in `website/config.js`.

Google account features can change; if appointment schedules are not available on your account, use a free scheduling alternative or a custom scheduling backend. Do not replace the link with a generic calendar URL.

## 2. Set up application email delivery
1. Visit https://script.google.com/ and create a new Apps Script project while signed in to the account that can send/receive Consilium mail.
2. Copy all of `google-apps-script/Code.gs` into `Code.gs` and save.
3. Click **Deploy → New deployment → Web app**.
4. Set **Execute as: Me**. Set access to **Anyone** if that option is available and appropriate for your account.
5. Deploy and authorize the script. Copy the deployed web-app URL ending in `/exec`.
6. Paste that URL into `APPS_SCRIPT_URL` in `website/config.js`.
7. Ensure `DESTINATION_EMAIL` in `Code.gs` is `consilium.consultinghq@gmail.com`.
8. If you change the script after deployment, manage the deployment and deploy a new version.

The script uses your Google account's Apps Script mail permissions and quotas. Test with a non-sensitive sample before public launch.

## 3. Test before sharing
- Open `apply.html` from your deployed website (not just a local file).
- Confirm the calendar appears and offers only the times you configured.
- Submit a test application using your own email.
- Check the destination inbox and spam folder.
- Check the applicant sees a success message only when the backend reports success.
- Book a test appointment and verify the Google Calendar confirmation arrives.
- Try submitting without a required field and without selecting an objective.
- Check on mobile.
- Do not promise that application submission itself confirms an appointment. Google Calendar sends a separate booking confirmation.

## 4. Deploy on GitHub Pages
1. Put the contents of the `website/` folder at the root of your GitHub Pages repository (so `index.html` is at the root).
2. Commit and push the files.
3. In GitHub, open **Settings → Pages**, choose your publishing source/branch and folder, then save.
4. Open the published URL and run the tests above.
5. Keep any future private credentials out of `config.js`; this is a public file.

## Notes
- The homepage displays `871+ clients served`, based on the claim provided by the site owner. Confirm that this claim is accurate and supportable before publishing.
- The site uses Google Fonts (IBM Plex Sans Condensed), so the font requires an internet connection. A system sans-serif fallback is included.
- The calendar is embedded from Google Calendar; its own interface may not inherit the website's dark theme on every account/browser. The surrounding Consilium page is dark. Do not use CSS tricks that break the calendar or conceal important provider disclosures.
- Static GitHub Pages cannot securely send email or reserve appointment slots by itself. The Apps Script endpoint sends applications; Google Calendar manages availability and bookings separately.
