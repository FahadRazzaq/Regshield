FROM python:3.11

WORKDIR /app

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 5001
EXPOSE 8000

CMD ["sh","-c","python server_app.py & python app.py"]