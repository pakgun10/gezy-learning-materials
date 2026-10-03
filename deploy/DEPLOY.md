# Deploy Gezy Learning Materials ke VPS

Panduan ini mengasumsikan VPS Ubuntu/Debian dengan nginx -- pola yang sama
seperti GezyLMS. Sesuaikan nama user, path, dan domain dengan milik Pak Gun.

## 1. Pasang Bun

Ikuti panduan resmi di situs Bun (bun.sh), lalu catat lokasi binary:

    which bun   # untuk ExecStart di file service

## 2. Ambil kode

    sudo mkdir -p /opt/gezy-learning-materials /var/lib/gezy-learning-materials /var/backups/gezy-learning-materials
    sudo chown -R www-data:www-data /opt/gezy-learning-materials /var/lib/gezy-learning-materials /var/backups/gezy-learning-materials
    sudo -u www-data git clone https://github.com/pakgun10/gezy-learning-materials.git /opt/gezy-learning-materials
    cd /opt/gezy-learning-materials
    sudo -u www-data bun install

## 3. Buat akun admin

Password minimal 10 karakter, jangan ditulis di file/chat:

    cd /opt/gezy-learning-materials
    sudo -u www-data env DATA_DIR=/var/lib/gezy-learning-materials ADMIN_USERNAME=pakgun ADMIN_PASSWORD='<password>' bun run setup-admin

## 4. Pasang systemd service

Sesuaikan dulu isi deploy/gezy-materials.service (User, WorkingDirectory,
ExecStart = lokasi bun dari `which bun`), lalu:

    sudo cp deploy/gezy-materials.service /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable --now gezy-materials
    sudo systemctl status gezy-materials
    curl -s http://127.0.0.1:3020/api/health

## 5. Pasang nginx + HTTPS

Sesuaikan server_name di deploy/nginx.conf (mis. materi.gezytech.web.id),
arahkan DNS ke IP VPS, lalu:

    sudo cp deploy/nginx.conf /etc/nginx/sites-available/gezy-materials
    sudo ln -s /etc/nginx/sites-available/gezy-materials /etc/nginx/sites-enabled/
    sudo nginx -t && sudo systemctl reload nginx
    sudo certbot --nginx -d materi.gezytech.web.id

Setelah HTTPS aktif, cookie sesi otomatis Secure (COOKIE_SECURE=1 dan nginx
mengirim header X-Forwarded-Proto: https).

## 6. Backup otomatis harian

Tes manual dulu:

    sudo env DATA_DIR=/var/lib/gezy-learning-materials BACKUP_DIR=/var/backups/gezy-learning-materials /opt/gezy-learning-materials/deploy/backup.sh

Lalu pasang cron sebagai root (crontab -e), tambahkan baris:

    0 2 * * * DATA_DIR=/var/lib/gezy-learning-materials BACKUP_DIR=/var/backups/gezy-learning-materials /opt/gezy-learning-materials/deploy/backup.sh >> /var/log/gezy-backup.log 2>&1

Arsip di /var/backups/gezy-learning-materials/ (retensi 14 hari).
Unduh salinannya ke tempat aman secara berkala.

## 7. Update aplikasi

    cd /opt/gezy-learning-materials
    sudo -u www-data git pull && sudo -u www-data bun install
    sudo systemctl restart gezy-materials

Data di /var/lib/gezy-learning-materials tidak tertimpa karena terpisah
dari folder kode (DATA_DIR).

## Mengembalikan backup

    sudo systemctl stop gezy-materials
    sudo tar -xzf /var/backups/gezy-learning-materials/gezy-materials-TANGGAL.tar.gz -C /var/lib/gezy-learning-materials
    sudo chown -R www-data:www-data /var/lib/gezy-learning-materials
    sudo systemctl start gezy-materials
