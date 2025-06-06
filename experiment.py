import pulp


# prob = pulp.LpProblem("TinyExample", pulp.LpMinimize)

# x = pulp.LpVariable("x", lowBound=0)
# y = pulp.LpVariable("y", lowBound=0)

# prob += 3*x + 2*y


# prob += x + y >= 5
# prob += x <= 4

# prob.solve()
# print("Статус:", pulp.LpStatus[prob.status])
# print("x =", x.value(), " y =", y.value(), " cost =", pulp.value(prob.objective))


prob = pulp.LpProblem("TinyExample", pulp.LpMaximize)

items = {
    1: (4,20),
    2: (3,18),
    3: (5,25),
    4: (2,8),
    5: (1,6),
}

x1 = pulp.LpVariable("x1", cat='Binary')
x2 = pulp.LpVariable("x2", cat='Binary')
x3 = pulp.LpVariable("x3", cat='Binary')
x4 = pulp.LpVariable("x4", cat='Binary')
x5 = pulp.LpVariable("x5", cat='Binary')

prob += x1*20 + x2*18 + x3*25 + x4*8 + x5*6

# prob += x1 + x2 + x3 + x4 + x5 >= 3
prob += x1*4 + x2*3 + x3*5 + x4*2 + x5*1 <= 10

prob.solve();

print(x1.value(), x2.value(), x3.value(), x4.value(), x5.value(), " value =", pulp.value(prob.objective))