# NFO Invite Template Documentation

## Overview
The NFO Invite template (typeId: 21) has been successfully added to the GrogBackend system. This template generates personalized National Finance Olympiad invitation PDFs from CSV data.

## Features
- ✅ Fully responsive A4 portrait layout
- ✅ Embedded base64 images for reliable PDF generation
- ✅ Template variable support ({{name}}, etc.)
- ✅ Professional styling with Google Fonts
- ✅ QR code integration for registration
- ✅ Landscape PDF output configuration

## File Structure
```
html/
└── NFOInvite.html                    # Main template file

public/cert-assets/
├── nfo-invite-2.png                  # Main invitation image
├── image-1204.png                    # QR code image  
├── frame-11889.png                   # Frame image 1
├── frame-11887.png                   # Frame image 2
├── frame-11889-1.png                 # Frame image 3
└── group-11805.png                   # Header group image

server.js                             # Updated with case 21 logic
```

## Template Variables
The template supports the following variables:
- `{{name}}` - Student's full name
- Any other CSV column can be used as a template variable

## CSV Format
Your CSV should include at least these columns:
```csv
name,email,phone,grade,school_name,student_username
John Doe,john.doe@email.com,9876543210,7,ABC International School,john_doe
```

## API Usage

### 1. Upload CSV Data
```bash
curl -X POST http://localhost:8080/api/upload_csv \
  -F "file=@sample-nfo-invite.csv"
```

### 2. Generate PDFs
```bash
curl -X POST http://localhost:8080/api/upload-html \
  -H "Content-Type: application/json" \
  -d '{"typeId": 21}' \
  --output nfo-invites.zip
```

## Complete Example

### Step 1: Prepare your CSV file
Create a file named `students.csv`:
```csv
name,email,phone,grade,school_name,student_username
John Doe,john@email.com,9876543210,7,ABC School,john_doe
Sarah Smith,sarah@email.com,9876543211,8,XYZ School,sarah_smith
```

### Step 2: Start the server
```bash
node server.js
```

### Step 3: Upload CSV
```bash
curl -X POST http://localhost:8080/api/upload_csv \
  -F "file=@students.csv"
```
Response: `{"message":"received csv file"}`

### Step 4: Generate PDFs
```bash
curl -X POST http://localhost:8080/api/upload-html \
  -H "Content-Type: application/json" \
  -d '{"typeId": 21}' \
  --output invitations.zip
```

### Step 5: Extract and view PDFs
```bash
unzip invitations.zip
# Files will be named: john_doe.pdf, sarah_smith.pdf
```

## Template Configuration

### Page Settings (Case 21)
- **Format**: A4 
- **Orientation**: Landscape (as configured in generatePDFWithPuppeteer)
- **Dimensions**: 297mm x 210mm
- **Margins**: 10mm on all sides
- **Background**: Printed

### Images Used
1. **nfo-invite-2.png** (273KB) - Main invitation graphic
2. **image-1204.png** (2.5KB) - QR code for registration
3. **frame-11889.png** (10KB) - Decorative frame 1
4. **frame-11887.png** (16KB) - Decorative frame 2  
5. **frame-11889-1.png** (14KB) - Decorative frame 3
6. **group-11805.png** (6.5KB) - Header logo/branding

## Troubleshooting

### Issue: Empty ZIP file
**Cause**: CSV not uploaded or typeId incorrect
**Solution**: 
1. Ensure CSV is uploaded first with `/api/upload_csv`
2. Verify typeId is exactly `21`
3. Check server logs for errors

### Issue: PDF generation fails
**Cause**: Missing images or template errors
**Solution**:
1. Verify all images exist in `public/cert-assets/`
2. Check image file permissions
3. Ensure template variables match CSV columns

### Issue: Images not showing in PDF
**Cause**: Base64 conversion failed
**Solution**:
1. Check image file formats (PNG/JPG supported)
2. Verify file paths in `server.js` case 21
3. Ensure images are not corrupted

### Issue: Server won't start
**Cause**: Port conflict or missing dependencies
**Solution**:
```bash
# Check if port 8080 is in use
lsof -i :8080

# Install dependencies
npm install

# Try different port
PORT=3000 node server.js
```

## Testing
A test file `sample-nfo-invite.csv` is included for testing:
```bash
# Quick test
curl -X POST http://localhost:8080/api/upload_csv -F "file=@sample-nfo-invite.csv"
curl -X POST http://localhost:8080/api/upload-html -H "Content-Type: application/json" -d '{"typeId": 21}' --output test.zip
```

## Integration Notes

### Adding to Existing Applications
The NFO Invite template follows the same pattern as other templates:
- Uses the same CSV upload endpoint
- Uses the same PDF generation endpoint  
- Only requires specifying `typeId: 21`
- Returns ZIP file with named PDFs

### Customization
To modify the template:
1. Edit `html/NFOInvite.html` for layout/styling
2. Replace images in `public/cert-assets/` 
3. Update image references in server.js case 21 if needed
4. Add new template variables by updating CSV structure

## Performance
- **Batch Processing**: 10 PDFs per batch (configurable)
- **Progress Tracking**: Real-time progress bars in console
- **Memory Cleanup**: Automatic temp file cleanup after ZIP creation
- **Timeout**: 120 seconds per PDF generation

## Support
For issues or questions about the NFO Invite template:
1. Check server console logs for detailed error messages
2. Verify CSV format matches expected structure
3. Ensure all required images are present
4. Test with provided sample CSV first

---
*Template added on: January 4, 2025*  
*Compatible with: GrogBackend v1.0+* 