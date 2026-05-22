from airflow import DAG
from airflow.operators.bash import BashOperator
from datetime import datetime

with DAG(
    dag_id="regshield_pipeline",
    start_date=datetime(2026,1,1),
    schedule="@daily",
    catchup=False
) as dag:

    health = BashOperator(
        task_id="check_health",
        bash_command="curl http://host.docker.internal:8000/health"
    )

    reindex = BashOperator(
        task_id="reindex",
        bash_command="curl -X POST http://host.docker.internal:8000/reindex"
    )

    health >> reindex