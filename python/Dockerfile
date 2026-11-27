# the container the scheduler's "containers" route runs. It is the same entry point as the
# workflow, so both routes mirror identically and either can stand in for the other.
# pinned by digest so a rebuild gets the same base. Dependabot moves the digest forward.
FROM python:3.12-slim@sha256:191083cdf6c7bda8c76158983163ead5d5cf7b77cf3033e805bb0f5296f51b4b

RUN apt-get update \
    && apt-get install -y --no-install-recommends git git-lfs ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && git lfs install --system

# runs as an unprivileged user, since nothing here needs root
RUN useradd --create-home --uid 10001 mirror
WORKDIR /app
COPY pyproject.toml requirements.txt ./
COPY fleet_common ./fleet_common
COPY mirror ./mirror
COPY backup ./backup
RUN pip install --no-cache-dir --require-hashes -r requirements.txt \
    && pip install --no-cache-dir --no-deps --no-build-isolation .

USER mirror
ENTRYPOINT ["python", "-m"]
CMD ["mirror"]
