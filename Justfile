# Help
default:
    just --list

# Build Docker Image
build-image:
    docker build -t ranckosolutionsinc/locci-farm:1.0 . 

# Push Docker image 
push-image:
    docker push ranckosolutionsinc/locci-farm:1.0

# Run Docker container
run-docker:
    docker run -dp 5151:5151 --name locci-farm ranckosolutionsinc/locci-farm:1.0

  