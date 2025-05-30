.PHONY: start-env freeze-deps

start-env:
	source .venv/bin/activate
	pip install -r requirements.txt

freeze-deps:
	pip freeze > requirements.txt