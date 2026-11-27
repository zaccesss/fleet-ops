# the container the scheduler's "containers" route runs. It is the same entry point as the
# workflow, so both routes mirror identically and either can stand in for the other.
FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends git git-lfs ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && git lfs install --system

# runs as an unprivileged user, since nothing here needs root
RUN useradd --create-home --uid 10001 mirror
WORKDIR /app
COPY pyproject.toml ./
COPY fleet_common ./fleet_common
COPY mirror ./mirror
COPY backup ./backup
RUN pip install --no-cache-dir .

USER mirror
ENTRYPOINT ["python", "-m"]
CMD ["mirror"]
