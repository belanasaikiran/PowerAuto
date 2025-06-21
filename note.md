```bash
docker run --name postgres-power \
  -e POSTGRES_USER=power \
  -e POSTGRES_PASSWORD=pass \
  -e POSTGRES_DB=powerdb \
  -p 5432:5432 \
  -d postgres
  ```
