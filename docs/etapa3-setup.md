# BarrioTech — Setup Checklist (Etapa 3 cierre)

Fecha: 2026-06-28
Estado: ✅ items 1-3 listos (cron + uptime endpoint + first backup).
Pendiente: configurar UptimeRobot y S3 cuando quieras.

---

## 1. ✅ Cron de backups — CONFIGURADO

```
30 3 * * * /home/telchar/barriotech/scripts/backup-db.sh >> /var/log/barriotech-backup.log 2>&1
```

**Por qué 30 3 (no 0 3):** ya hay un cron semanal a `0 3 * * 0` (Neuralflow).
Lo moví 30 min después para evitar carrera de pg_dump simultáneo.

**Verificar:**

```bash
crontab -l | grep gps        # debe listar la línea de arriba
tail -20 /var/log/barriotech-backup.log   # después de mañana 3:30am
ls -lh /home/telchar/barriotech/backups/  # debe haber un .sql.gz nuevo
```

**Restaurar desde un backup:**

```bash
gunzip -c /home/telchar/barriotech/backups/gps_street_sellers_YYYY-MM-DD_HHMMSS.sql.gz \
  | psql -h localhost -U postgres -d gps_street_sellers
```

---

## 2. ⏳ UptimeRobot — PENDIENTE (5 minutos)

**Endpoint live (ya verificado):**

```
URL: https://barriotech.com.co/api/health/ready
HTTP: 200 en ~155ms (HTTPS HTTP/2 vía Caddy)
Body: {"status":"ok","checks":{"database":{"status":"ok","latencyMs":32}}}
```

**Pasos en UptimeRobot (free tier, 50 monitors / 5-min interval):**

1. Login en https://uptimerobot.com → "+ Add New Monitor"
2. Monitor Type: **HTTP(s)**
3. Friendly Name: `BarrioTech — DB Ready`
4. URL: `https://barriotech.com.co/api/health/ready`
5. Monitoring Interval: **5 minutes** (free tier mínimo)
6. Monitor Timeout: **30 seconds**
7. HTTP Method: GET (default)
8. Keyword Exists: dejar vacío (queremos validar status code, no contenido)
9. ⚠️ **Importante — "Advanced Settings"**:
   - **Alert Contacts**: tu email/Telegram (configurar en My Settings primero)
10. Create Monitor

**Configurar alerta crítica (recomendado):**

- Settings → "When down: alert after X consecutive failures" → **2 checks** (10 min)
  → Evita falsos positivos por una falla aislada de la red.
- Settings → "Resend alert every X minutes while down" → **30 minutes**
  → Para que te acuerdes si el sitio sigue caído.

**Health checks redundantes (opcional):**

- Segundo monitor: `GET /api/health` (cheap, sin DB) → te avisa aunque la DB esté OK
  pero la app esté zombie. Menos crítico, baja prioridad.

**Test de fuego rápido:**

```bash
# Simular caída — matar PM2
pm2 stop gps
# Espera 5-10 min — UptimeRobot debe alertar
pm2 start gps
# Espera 5 min más — debe volver a OK
```

---

## 3. ⏳ S3 backup off-site — OPCIONAL

**Por qué:** backups locales son buenos pero si el server muere, los pierdes.
Off-site en S3 / DigitalOcean Spaces / Backblaze B2 = insurance barato.

**Setup (DigitalOcean Spaces — recomendado por simplicidad y precio):**

1. Crear Space en https://cloud.digitalocean.com/spaces
   - Region: NYC3 (cerca)
   - Name: `barriotech-backups`
   - Enable CDN: no (más barato + privado)
   - File Listing: Restricted (privado)

2. Crear Spaces Access Key (API):
   - API → Spaces Keys → Generate New Key
   - Scope: solo el Space `barriotech-backups`
   - Guardar: `ACCESS_KEY_ID` + `SECRET_ACCESS_KEY`

3. Instalar `s3cmd` (cliente simple) o usar `aws-cli`:

```bash
sudo apt install -y awscli   # o pip install awscli
aws configure
# AWS Access Key ID: <ACCESS_KEY_ID>
# AWS Secret Access Key: <SECRET_ACCESS_KEY>
# Default region name: us-east-1     ← DigitalOcean usa "us-east-1"
# Default output format: json
```

4. Configurar endpoint custom para DO Spaces:

```bash
# Agregar a ~/.aws/config
echo '[default]' >> ~/.aws/config
echo 'endpoint_url = https://nyc3.digitaloceanspaces.com' >> ~/.aws/config
```

5. Agregar al `.env` del proyecto:

```bash
echo 'BACKUP_S3_BUCKET=barriotech-backups' >> /home/telchar/barriotech/apps/web/.env
echo 'BACKUP_S3_ENDPOINT=https://nyc3.digitaloceanspaces.com' >> /home/telchar/barriotech/apps/web/.env
```

6. Probar:

```bash
# Subir manualmente el último backup para validar
LATEST=$(ls -t /home/telchar/barriotech/backups/*.sql.gz | head -1)
aws s3 cp "$LATEST" "s3://barriotech-backups/db-backups/test-upload.sql.gz"

# Verificar
aws s3 ls s3://barriotech-backups/db-backups/
```

7. Confirmar que el cron subirá automáticamente la próxima vez:

```bash
# Cron está a las 3:30am. Para validar sin esperar, ejecutar:
BACKUP_S3_BUCKET=barriotech-backups BACKUP_S3_ENDPOINT=https://nyc3.digitaloceanspaces.com \
  /home/telchar/barriotech/scripts/backup-db.sh
# Debe terminar con "[backup] uploaded to s3://..."
```

**Alternativa más barata — Backblaze B2** (10 GB gratis):

- https://www.backblaze.com/b2/cloud-storage.html
- Mismo patrón con `aws-cli` y endpoint `https://s3.us-west-001.backblazeb2.com`

**Restore desde S3:**

```bash
aws s3 cp s3://barriotech-backups/db-backups/gps_street_sellers_2026-06-29_033001.sql.gz /tmp/
gunzip -c /tmp/gps_street_sellers_2026-06-29_033001.sql.gz | psql -h localhost -U postgres -d gps_street_sellers
```

---

## Resumen ejecutivo

| Item | Estado | Comando verificar |
|---|---|---|
| Cron backup 3:30am | ✅ activo | `crontab -l \| grep gps` |
| Log file | ✅ `/var/log/barriotech-backup.log` | `ls -la /var/log/barriotech-backup.log` |
| First backup | ✅ 7.5KB, 15 tablas | `ls /home/telchar/barriotech/backups/` |
| Endpoint HTTPS | ✅ 200 en 155ms | `curl -sI https://barriotech.com.co/api/health/ready` |
| UptimeRobot | ⏳ setup manual 5min | ver sección 2 |
| S3 off-site | ⏳ opcional | ver sección 3 |