# RegShield

A compliance-focused RAG platform that retrieves regulatory clauses 
and generates grounded answers through four search modes: lexical, 
semantic, hybrid, and RAG.

Built with production reliability principles from Google SRE.

---

## What It Does

RegShield accepts a compliance query and returns a grounded answer 
by retrieving relevant regulatory clauses from an indexed document 
store. Four retrieval modes are available depending on the 
precision and cost tradeoff required:

- **Lexical** — keyword-based retrieval, lowest latency
- **Semantic** — embedding-based retrieval using Sentence Transformers
- **Hybrid** — combines lexical and semantic paths
- **RAG** — retrieval followed by Gemini-grounded answer generation

---

## Stack

| Layer | Technology |
|---|---|
| API | FastAPI |
| Containerization | Docker |
| Orchestration | Kubernetes (AWS EKS) |
| Registry | AWS ECR |
| CI/CD | GitHub Actions |
| Experiment Tracking | MLflow |
| Pipeline Automation | Apache Airflow |
| Monitoring | Prometheus + Grafana |
| LLM | Google Gemini |
| Embeddings | Sentence Transformers |

---

## Observability

RegShield implements Google SRE's four golden signals across 
both service and application layers.

**Service metrics** — HTTP request rate, error rate, p90 and 
p99 latency tracked via prometheus_fastapi_instrumentator.

**RAG metrics** — Custom Prometheus counters and gauges tracking 
searches by retrieval mode, cumulative latency by mode, CPU usage, 
and memory usage.

Key findings from the current deployment:
- Error rate is inside the 97% SLO threshold
- p90 latency: 437.60ms, p99 latency: 493.76ms
- Memory sits consistently at ~90% due to Sentence Transformers 
  model being kept in RAM
- RAG mode contributes the most cumulative latency as expected 
  from external Gemini calls

Full write-up: [From Uptime to Observability in a RAG System](https://medium.com/@fahad.razzaq0701/from-uptime-to-observability-in-a-rag-system-364bc01e29d3)

---

## Screenshots

### Search Interface
![RegShield search interface](https://github.com/FahadRazzaq/Regshield/blob/main/assets/RegShield-search-interface.jpg)

### System Architecture
![System architecture](https://github.com/FahadRazzaq/Regshield/blob/main/assets/System%20Architecture.png)

### Grafana — Four Golden Signals Dashboard
![Grafana observability dashboard](https://github.com/FahadRazzaq/Regshield/blob/main/assets/Grafana%20Dashboard.png)

### MLflow — Experiment Tracking
![MLflow dashboard](https://github.com/FahadRazzaq/Regshield/blob/main/assets/mlflow-dashboard.jpg)

### Airflow — Pipeline DAG
![Airflow DAG](https://github.com/FahadRazzaq/Regshield/blob/main/assets/Airflow-dag.jpg)

---

## Project Structure
---
regshield/
├── app/
│   ├── main.py              # FastAPI application
│   ├── search.py            # Retrieval logic by mode
│   ├── metrics.py           # Custom Prometheus metrics
│   └── reindex.py           # Document indexing pipeline
├── monitoring/
│   ├── prometheus.yml       # Prometheus scrape config
│   └── grafana/             # Dashboard JSON exports
├── dags/
│   └── reindex_dag.py       # Airflow reindexing DAG
├── .github/
│   └── workflows/
│       └── deploy.yml       # GitHub Actions CI/CD pipeline
├── Dockerfile
├── docker-compose.yml
└── requirements.txt
---

## What Is Still Being Built

- AlertManager integration with SLO burn rate alerts
- Gemini dependency latency tracking
- Per-mode latency histograms
- Logs and distributed traces
- Request IDs for debugging
- Long-term metric retention

---

## Author

Fahad Razzaq - Data and MLOps practitioner.  
Writing on production reliability for AI systems at 
[Medium](https://medium.com/@fahad.razzaq0701)
